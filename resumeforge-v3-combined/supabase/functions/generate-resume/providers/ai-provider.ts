// ─────────────────────────────────────────
// providers/ai-provider.ts — Two-provider orchestration core
//
// AIProvider
// ├── GeminiProvider  — Google Generative Language API (generateContent)
// └── GroqProvider    — Groq OpenAI-compatible chat completions
//
// Both providers return the SAME normalized shape and throw the SAME
// AIError type on failure — the phase logic in index.ts never branches
// on which provider it's talking to.
//
// runAIPhase() is the bounded retry/failover loop used by every phase:
//   1. Try the phase's default provider (timeout-bound, AbortController).
//   2. On a retryable failure (429 / 5xx / timeout / malformed JSON),
//      try ONCE MORE on the same provider if it's a malformed-JSON repair
//      case, then fail over to the alternate provider.
//   3. Never more than MAX_ATTEMPTS_PER_PHASE total provider attempts —
//      this bounds retries so a phase can never loop forever or blow the
//      request deadline.
//   4. Auth failures (401/403) are terminal for that provider immediately
//      — no point retrying a bad key — and we fail over right away.
//
// RATE LIMITS (checked against current provider docs, 2026):
//   Groq free tier   ≈ 30 requests/min, 6-30k TPM depending on model,
//                      up to 14,400 requests/day — org-wide, not per-key.
//   Gemini free tier ≈ 10-15 requests/min, ~250k TPM, 250-1,500 req/day
//                      depending on model — per-project.
// One resume generation makes at most 2 Gemini calls + 3 Groq calls
// (phases 1-2 Gemini, background-context + phases 3-4 Groq), run
// strictly SEQUENTIALLY (never overlapping), which stays well inside
// either free tier for normal usage. Bounded retries + Retry-After
// honoring keep a single slow user from burning the whole quota.
// ─────────────────────────────────────────

import { AIError, type AIErrorType } from "./errors.ts";

export type ProviderName = "gemini" | "groq";

export interface ProviderCallResult {
  text: string;
  provider: ProviderName;
  model: string;
  durationMs: number;
}

export interface ProviderCallOptions {
  prompt: string;
  temperature: number;
  maxTokens: number;
  label: string;
  deadline: number; // shared epoch-ms budget for the whole request
  jsonMode: boolean; // request structured JSON from the provider
  modelOverride?: string; // optional explicit model id (e.g. cheap context model)
}

// ── timeouts ──
// Every external AI request has a hard per-call timeout via AbortController
// so a hung provider connection can never stall the whole function past the
// Supabase Edge Function platform limit (~150s per request).
const PER_CALL_TIMEOUT_MS = 45_000;
export const REQUEST_DEADLINE_BUDGET_MS = 120_000; // shared budget across all phases
const MAX_ATTEMPTS_PER_PHASE = 4; // hard ceiling: e.g. gemini try, gemini repair, groq try, groq repair
const MAX_JSON_REPAIR_PER_PROVIDER = 1;

function msLeft(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

// ════════════════════════════════════════
// GEMINI PROVIDER
// ════════════════════════════════════════
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

async function geminiCall(p: ProviderCallOptions): Promise<ProviderCallResult> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new AIError("PROVIDER_UNAVAILABLE", "Gemini is not configured (GEMINI_API_KEY missing).", undefined, "gemini");

  const model = p.modelOverride || Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";
  const url = `${GEMINI_BASE}/${model}:generateContent`;
  const t0 = Date.now();

  const timeoutMs = Math.min(PER_CALL_TIMEOUT_MS, msLeft(p.deadline));
  if (timeoutMs <= 0) throw new AIError("PROVIDER_TIMEOUT", `Deadline exceeded before calling Gemini for "${p.label}".`, undefined, "gemini");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key, // never in the URL query string, never logged
      },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: p.prompt }] }],
        generationConfig: {
          temperature: p.temperature,
          maxOutputTokens: p.maxTokens,
          ...(p.jsonMode ? { responseMimeType: "application/json" } : {}),
        },
      }),
    });
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new AIError("PROVIDER_TIMEOUT", `Gemini request timed out for "${p.label}".`, undefined, "gemini");
    }
    throw new AIError("PROVIDER_SERVER_ERROR", `Gemini network error for "${p.label}".`, undefined, "gemini");
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const retryAfterHeader = res.headers.get("retry-after");
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;
    if (res.status === 401 || res.status === 403) {
      throw new AIError("PROVIDER_AUTH_FAILED", `Gemini key problem while running "${p.label}".`, undefined, "gemini");
    }
    if (isRetryableHttpStatus(res.status)) {
      throw new AIError(
        res.status === 429 ? "PROVIDER_RATE_LIMITED" : "PROVIDER_SERVER_ERROR",
        `Gemini returned HTTP ${res.status} for "${p.label}".`,
        retryAfterMs,
        "gemini",
      );
    }
    throw new AIError("PROVIDER_SERVER_ERROR", `Gemini returned HTTP ${res.status} for "${p.label}".`, undefined, "gemini");
  }

  const bodyText = await res.text();
  let data: { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  try {
    data = JSON.parse(bodyText);
  } catch {
    throw new AIError("INVALID_AI_RESPONSE", "Gemini returned a malformed (non-JSON) response.", undefined, "gemini");
  }
  const text = (data?.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text || "")
    .join("")
    .trim();
  if (!text) throw new AIError("INVALID_AI_RESPONSE", "Gemini returned an empty completion.", undefined, "gemini");

  return { text, provider: "gemini", model, durationMs: Date.now() - t0 };
}

// ════════════════════════════════════════
// GROQ PROVIDER
// ════════════════════════════════════════
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

async function groqCall(p: ProviderCallOptions): Promise<ProviderCallResult> {
  const key = Deno.env.get("GROQ_API_KEY");
  if (!key) throw new AIError("PROVIDER_UNAVAILABLE", "Groq is not configured (GROQ_API_KEY missing).", undefined, "groq");

  const model = p.modelOverride || Deno.env.get("GROQ_MODEL") || "openai/gpt-oss-120b";
  const t0 = Date.now();

  const timeoutMs = Math.min(PER_CALL_TIMEOUT_MS, msLeft(p.deadline));
  if (timeoutMs <= 0) throw new AIError("PROVIDER_TIMEOUT", `Deadline exceeded before calling Groq for "${p.label}".`, undefined, "groq");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`, // never logged
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: p.prompt }],
        temperature: p.temperature,
        max_tokens: p.maxTokens,
        ...(p.jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    });
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new AIError("PROVIDER_TIMEOUT", `Groq request timed out for "${p.label}".`, undefined, "groq");
    }
    throw new AIError("PROVIDER_SERVER_ERROR", `Groq network error for "${p.label}".`, undefined, "groq");
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const retryAfterHeader = res.headers.get("retry-after");
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;
    if (res.status === 401 || res.status === 403) {
      throw new AIError("PROVIDER_AUTH_FAILED", `Groq key problem while running "${p.label}".`, undefined, "groq");
    }
    if (isRetryableHttpStatus(res.status)) {
      throw new AIError(
        res.status === 429 ? "PROVIDER_RATE_LIMITED" : "PROVIDER_SERVER_ERROR",
        `Groq returned HTTP ${res.status} for "${p.label}".`,
        retryAfterMs,
        "groq",
      );
    }
    throw new AIError("PROVIDER_SERVER_ERROR", `Groq returned HTTP ${res.status} for "${p.label}".`, undefined, "groq");
  }

  const bodyText = await res.text();
  let data: { choices?: { message?: { content?: string } }[] };
  try {
    data = JSON.parse(bodyText);
  } catch {
    throw new AIError("INVALID_AI_RESPONSE", "Groq returned a malformed (non-JSON) response.", undefined, "groq");
  }
  const text = (data?.choices?.[0]?.message?.content || "").trim();
  if (!text) throw new AIError("INVALID_AI_RESPONSE", "Groq returned an empty completion.", undefined, "groq");

  return { text, provider: "groq", model, durationMs: Date.now() - t0 };
}

async function callProvider(provider: ProviderName, opts: ProviderCallOptions): Promise<ProviderCallResult> {
  return provider === "gemini" ? geminiCall(opts) : groqCall(opts);
}

// ════════════════════════════════════════
// SAFE LOGGING (no keys, no headers, no full user data)
// ════════════════════════════════════════
export function logAttempt(entry: {
  generationId: string;
  phase: number | string;
  provider: ProviderName;
  attempt: number;
  status: "success" | "failed";
  durationMs: number;
  errorType?: AIErrorType;
  fallback?: ProviderName;
}) {
  const parts = [
    `generation_id=${entry.generationId}`,
    `phase=${entry.phase}`,
    `provider=${entry.provider}`,
    `attempt=${entry.attempt}`,
    `status=${entry.status}`,
    `duration_ms=${entry.durationMs}`,
  ];
  if (entry.errorType) parts.push(`error_type=${entry.errorType}`);
  if (entry.fallback) parts.push(`fallback=${entry.fallback}`);
  console.log(parts.join(" "));
}

// ════════════════════════════════════════
// runAIPhase — bounded retry + failover loop
// ════════════════════════════════════════
export interface RunAIPhaseOptions {
  generationId: string;
  phase: number;
  name: string; // human label, e.g. "pass1-keywords"
  prompt: string;
  temperature: number;
  maxTokens: number;
  deadline: number;
  defaultProvider: ProviderName;
  fallbackProvider: ProviderName | null;
  jsonMode?: boolean;
  modelOverride?: string;
  /** Optional schema validator — if it returns false, treated as a repairable failure. */
  validate?: (parsed: unknown) => boolean;
  parse?: (text: string) => unknown; // defaults to schema.ts parseJSON
}

export interface RunAIPhaseResult {
  text: string;
  parsed: unknown;
  providerUsed: ProviderName;
  attempts: number;
  repaired: boolean;
  durationMs: number;
}

function defaultParse(raw: string): unknown {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object found in AI response");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function buildFailureMessage(name: string, log: { provider: ProviderName; type: AIErrorType }[]): string {
  const summary = log.map((l) => `${l.provider}:${l.type}`).join(", ");
  return `AI phase "${name}" failed on both providers after bounded retries (${summary}). Please try again in a minute.`;
}

/**
 * Runs one pipeline phase with bounded provider failover:
 *   defaultProvider (attempt) -> defaultProvider (repair, if JSON invalid)
 *   -> fallbackProvider (attempt) -> fallbackProvider (repair, if JSON invalid)
 * Never exceeds MAX_ATTEMPTS_PER_PHASE total HTTP calls. Auth failures skip
 * straight to the alternate provider without wasting a repair attempt.
 */
export async function runAIPhase(opts: RunAIPhaseOptions): Promise<RunAIPhaseResult> {
  const providers: ProviderName[] = opts.fallbackProvider
    ? [opts.defaultProvider, opts.fallbackProvider]
    : [opts.defaultProvider];

  const parseFn = opts.parse || defaultParse;
  const log: { provider: ProviderName; type: AIErrorType }[] = [];
  let totalAttempts = 0;
  const overallStart = Date.now();

  for (const provider of providers) {
    let lastRaw = "";
    for (let pass = 0; pass <= MAX_JSON_REPAIR_PER_PROVIDER; pass++) {
      if (totalAttempts >= MAX_ATTEMPTS_PER_PHASE) break;
      if (msLeft(opts.deadline) <= 0) {
        throw new AIError("PROVIDER_TIMEOUT", `Deadline exceeded running "${opts.name}".`, undefined, provider);
      }
      totalAttempts++;

      const promptForAttempt =
        pass === 0
          ? opts.prompt
          : `${opts.prompt}\n\nYour previous response could not be parsed as valid JSON or did not match the required schema. Previous response:\n---\n${lastRaw.slice(0, 2000)}\n---\nReturn ONLY corrected, valid JSON — no markdown, no commentary.`;

      try {
        const result = await callProvider(provider, {
          prompt: promptForAttempt,
          temperature: opts.temperature,
          maxTokens: opts.maxTokens,
          label: opts.name,
          deadline: opts.deadline,
          jsonMode: !!opts.jsonMode,
          modelOverride: opts.modelOverride,
        });

        let parsed: unknown;
        try {
          parsed = parseFn(result.text);
        } catch {
          lastRaw = result.text;
          logAttempt({
            generationId: opts.generationId,
            phase: opts.phase,
            provider,
            attempt: totalAttempts,
            status: "failed",
            durationMs: result.durationMs,
            errorType: "INVALID_AI_RESPONSE",
          });
          log.push({ provider, type: "INVALID_AI_RESPONSE" });
          continue; // one controlled repair retry on same provider
        }

        if (opts.validate && !opts.validate(parsed)) {
          lastRaw = result.text;
          logAttempt({
            generationId: opts.generationId,
            phase: opts.phase,
            provider,
            attempt: totalAttempts,
            status: "failed",
            durationMs: result.durationMs,
            errorType: "VALIDATION_ERROR",
          });
          log.push({ provider, type: "VALIDATION_ERROR" });
          continue;
        }

        logAttempt({
          generationId: opts.generationId,
          phase: opts.phase,
          provider,
          attempt: totalAttempts,
          status: "success",
          durationMs: result.durationMs,
        });

        return {
          text: result.text,
          parsed,
          providerUsed: provider,
          attempts: totalAttempts,
          repaired: pass > 0,
          durationMs: Date.now() - overallStart,
        };
      } catch (err) {
        const aerr = err instanceof AIError ? err : new AIError("INTERNAL_ERROR", String(err));
        logAttempt({
          generationId: opts.generationId,
          phase: opts.phase,
          provider,
          attempt: totalAttempts,
          status: "failed",
          durationMs: 0,
          errorType: aerr.type,
          fallback: provider === opts.defaultProvider ? opts.fallbackProvider || undefined : undefined,
        });
        log.push({ provider, type: aerr.type });

        // Auth failures are terminal for this provider — move to the
        // alternate provider immediately (no repair retry wastes a call).
        if (aerr.type === "PROVIDER_AUTH_FAILED") break;

        // A malformed/empty provider response is worth ONE controlled
        // repair retry on the same provider before switching.
        if (aerr.type === "INVALID_AI_RESPONSE" && pass < MAX_JSON_REPAIR_PER_PROVIDER) {
          lastRaw = "";
          continue;
        }

        // Respect Retry-After when it's short enough to fit the deadline;
        // otherwise move straight to the alternate provider rather than
        // stalling the request.
        if (aerr.type === "PROVIDER_RATE_LIMITED" && aerr.retryAfterMs && aerr.retryAfterMs < msLeft(opts.deadline) && aerr.retryAfterMs < 15_000) {
          await new Promise((r) => setTimeout(r, aerr.retryAfterMs));
          continue;
        }

        break; // provider attempt failed at HTTP level -> move to alternate provider
      }
    }
  }

  // Both providers exhausted for this phase -> fail the job with a clear,
  // normalized error. The dominant error type across attempts decides the code.
  const types = log.map((l) => l.type);
  const all = (t: AIErrorType) => types.length > 0 && types.every((x) => x === t);
  const type: AIErrorType = all("PROVIDER_RATE_LIMITED")
    ? "PROVIDER_RATE_LIMITED"
    : all("PROVIDER_TIMEOUT")
    ? "PROVIDER_TIMEOUT"
    : all("PROVIDER_SERVER_ERROR")
    ? "PROVIDER_SERVER_ERROR"
    : all("PROVIDER_UNAVAILABLE")
    ? "PROVIDER_UNAVAILABLE"
    : all("PROVIDER_AUTH_FAILED")
    ? "PROVIDER_AUTH_FAILED"
    : types.includes("PROVIDER_RATE_LIMITED")
    ? "PROVIDER_RATE_LIMITED"
    : "INTERNAL_ERROR";
  const retryAfter = types.includes("PROVIDER_RATE_LIMITED") ? 60_000 : undefined;
  throw new AIError(type, buildFailureMessage(opts.name, log), retryAfter);
}
