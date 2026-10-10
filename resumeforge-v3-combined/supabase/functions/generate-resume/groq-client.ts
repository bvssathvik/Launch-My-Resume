// ─────────────────────────────────────────
// groq-client.ts — [DEPRECATED, NOT IMPORTED] Superseded by providers/ai-provider.ts
// (GroqProvider with normalized errors, timeouts, and bounded failover).
// Kept only for historical reference. index.ts no longer imports this file.
// ─────────────────────────────────────────

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export const PRIMARY_MODEL = "openai/gpt-oss-120b";
export const FALLBACK_MODEL = "llama-3.1-8b-instant";

const MAX_RETRIES_PER_MODEL = 4; // retries on the SAME model before giving up on it

// Cap for OUR OWN guessed exponential backoff (used only when Groq gives no
// explicit "try again in Xs" hint). This is unrelated to authoritative
// waits — see MAX_SINGLE_WAIT_MS below for the cap that actually applies to
// a wait Groq tells us to take.
const OWN_BACKOFF_CAP_MS = 20_000;

// Outer sanity ceiling on ANY single wait — including an authoritative one
// from Groq. We still honor Groq's number up to this point; we just refuse
// to let one malformed/extreme header value stall the function forever.
const MAX_SINGLE_WAIT_MS = 90_000;

const DEFAULT_TIMEOUT_MS = 60_000;

// Total time budget for the ENTIRE request (all 4 passes + background
// context combined), computed once in index.ts and threaded through every
// call as `deadline`. Set with headroom under Supabase's ~150s Edge
// Function timeout so we can always return a clean JSON error instead of
// being killed mid-request.
export const REQUEST_DEADLINE_BUDGET_MS = 110_000;

// Conservative account-level TPM ceiling used by the proactive scheduler.
// (Groq's dashboard is the source of truth — this is intentionally a
// slightly conservative default so the scheduler waits a little early
// rather than a little late.)
export const GROQ_TPM_LIMIT = 8_000;

// Groq's TPM limit is a rolling 60s window.
const RATE_WINDOW_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Thrown when the primary model's rate limit can't be cleared (or can't be
// safely waited out within the shared deadline). index.ts catches this
// specifically and returns HTTP 429 with a clear "try again shortly"
// message instead of a generic 500 — see NO SILENT DOWNGRADE above.
export class GroqRateLimitError extends Error {
  constructor(message: string, public retryAfterMs?: number) {
    super(message);
    this.name = "GroqRateLimitError";
  }
}

// ── Proactive TPM scheduler ──────────────────────────────────────────
// Tracks REAL token usage (from Groq's `usage` field on actual responses)
// in a rolling window so we can tell, before firing the next call, whether
// it's likely to blow the account's TPM budget — and wait out part of the
// window instead of firing blind and eating a guaranteed 429.
interface UsageEntry { ts: number; tokens: number; }
const usageLog: UsageEntry[] = [];

function pruneUsageLog(now: number): void {
  while (usageLog.length && now - usageLog[0].ts > RATE_WINDOW_MS) usageLog.shift();
}

function recordUsage(tokens: number | null | undefined): void {
  if (!tokens || tokens <= 0) return;
  usageLog.push({ ts: Date.now(), tokens });
}

function currentWindowUsage(now: number): number {
  pruneUsageLog(now);
  return usageLog.reduce((sum, e) => sum + e.tokens, 0);
}

// Returns ms to wait before it's safe to fire a call that might need up to
// `estimatedTokens`, or 0 if there's already room. Estimate is based on
// REAL usage recorded from previous responses, not on maxTokens ceilings —
// see file header.
function msUntilBudgetFrees(estimatedTokens: number, now: number): number {
  const used = currentWindowUsage(now);
  if (used + estimatedTokens <= GROQ_TPM_LIMIT) return 0;
  if (!usageLog.length) return 0; // nothing recorded yet to wait on
  const oldest = usageLog[0];
  const msUntilOldestExpires = RATE_WINDOW_MS - (now - oldest.ts) + 250; // small buffer
  return Math.max(0, msUntilOldestExpires);
}

// Called before every Groq attempt. Waits proactively if recent REAL usage
// suggests this call would exceed the account's rolling TPM budget. Throws
// GroqRateLimitError immediately (without sleeping) if the wait needed
// would blow the shared request deadline — better to fail fast with a
// clear message than to sleep past the point where we could still respond.
async function throttleBeforeCall(
  estimatedTokens: number,
  deadline: number,
  label: string
): Promise<void> {
  const now = Date.now();
  let waitMs = msUntilBudgetFrees(estimatedTokens, now);
  if (waitMs <= 0) return;

  const remaining = deadline - now;
  if (waitMs > remaining) {
    throw new GroqRateLimitError(
      `Groq's rate-limit window won't clear in time to safely run "${label}" within this request. ` +
        `Please try again in about a minute.`,
      waitMs
    );
  }

  waitMs = Math.min(waitMs, MAX_SINGLE_WAIT_MS, remaining);
  console.log(
    `[groq-scheduler] Proactively waiting ${waitMs}ms before "${label}" — recent usage is close to the ${GROQ_TPM_LIMIT} TPM budget.`
  );
  await sleep(waitMs);
}

// Groq's 429 body looks like:
// { "error": { "message": "...Limit 8000, Used 5583, Requested 3344...
//   Please try again in 13.037s...", "type": "tokens", "code": "rate_limit_exceeded" } }
// Some responses also carry a `retry-after` header (seconds).
function parseRetryAfterMs(res: Response, bodyText: string): number | null {
  const headerVal = res.headers.get("retry-after");
  if (headerVal) {
    const secs = parseFloat(headerVal);
    if (!isNaN(secs)) return Math.ceil(secs * 1000);
  }
  const match = bodyText.match(/try again in\s+([\d.]+)(ms|s)/i);
  if (match) {
    const value = parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    if (!isNaN(value)) return Math.ceil(unit === "ms" ? value : value * 1000);
  }
  return null;
}

export interface GroqMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// Token usage as reported by Groq for a single successful completion.
interface GroqUsage {
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
}

interface ModelCallResult {
  text: string | null;
  usage: GroqUsage | null;
  status: number | null; // final HTTP status observed for this model (null = network/timeout error, no response)
  retryCount: number;    // number of retries attempted on this model before this outcome
  retryWaitMs: number;   // cumulative ms spent waiting between retries for this model
  rateLimitExhausted: boolean; // true if we gave up specifically because of 429s / scheduler deadline
}

// ── Safe, whitelisted token-usage logging ──
// Logs ONLY the six approved fields. NEVER logs prompts, resume/job/
// LinkedIn content, or the API key. Call this exactly once per Groq
// HTTP response (success or terminal failure).
function logGroqUsage(entry: {
  label: string;
  model: string;
  status: number | null;
  usage: GroqUsage | null;
  retryCount: number;
  retryWaitMs: number;
}): void {
  console.log("[groq-usage]", JSON.stringify({
    pass: entry.label,
    model: entry.model,
    prompt_tokens: entry.usage?.prompt_tokens ?? null,
    completion_tokens: entry.usage?.completion_tokens ?? null,
    total_tokens: entry.usage?.total_tokens ?? null,
    http_status: entry.status,
    retry_count: entry.retryCount,
    retry_wait_ms: entry.retryWaitMs,
  }));
}

// Low-level call: tries ONE model, with retry-on-429/5xx (same model, no
// downgrade). Emits exactly one [groq-usage] log line for the terminal
// outcome of this model attempt (success, or retries exhausted). Respects
// the shared `deadline` — see file header ("SHARED REQUEST DEADLINE").
async function callModelWithRetry(
  messages: GroqMessage[],
  key: string,
  model: string,
  maxTokens: number,
  temperature: number,
  label: string,
  errors: string[],
  deadline: number
): Promise<ModelCallResult> {
  let retryCount = 0;
  let retryWaitMs = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES_PER_MODEL; attempt++) {
    // Proactive scheduler: wait BEFORE firing if recent real usage suggests
    // this call would blow the rolling TPM budget. Can throw if the wait
    // would exceed the deadline.
    await throttleBeforeCall(maxTokens, deadline, label);

    try {
      const res = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });

      if (res.ok) {
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;
        const rawUsage = data?.usage;
        const usage: GroqUsage | null = rawUsage
          ? {
              prompt_tokens: rawUsage.prompt_tokens ?? null,
              completion_tokens: rawUsage.completion_tokens ?? null,
              total_tokens: rawUsage.total_tokens ?? null,
            }
          : null;

        // Feed REAL usage back into the scheduler so the next call's
        // throttling decision is based on actual consumption, not a guess.
        recordUsage(usage?.total_tokens ?? null);

        logGroqUsage({ label, model, status: res.status, usage, retryCount, retryWaitMs });

        if (!text) {
          errors.push(`${model} -> no text in response`);
          return { text: null, usage, status: res.status, retryCount, retryWaitMs, rateLimitExhausted: false };
        }
        return { text, usage, status: res.status, retryCount, retryWaitMs, rateLimitExhausted: false };
      }

      const errBody = await res.text();

      // Only 429 (rate limit) and 5xx (transient server issues) are worth
      // retrying on the SAME model. A 4xx like 400/401/404 will never
      // succeed on retry, so fail fast instead of wasting time.
      const retryable = res.status === 429 || res.status >= 500;
      errors.push(`${model} -> HTTP ${res.status} (attempt ${attempt + 1}/${MAX_RETRIES_PER_MODEL + 1}): ${errBody.slice(0, 300)}`);

      if (!retryable || attempt === MAX_RETRIES_PER_MODEL) {
        logGroqUsage({ label, model, status: res.status, usage: null, retryCount, retryWaitMs });
        return {
          text: null, usage: null, status: res.status, retryCount, retryWaitMs,
          rateLimitExhausted: res.status === 429,
        };
      }

      // Groq's own instruction, if present, is authoritative — honor it
      // rather than truncating it to our own backoff cap. Only OUR guessed
      // exponential backoff (used when Groq gives no hint) is capped at
      // OWN_BACKOFF_CAP_MS. Either way, MAX_SINGLE_WAIT_MS is the outer
      // sanity ceiling so a pathological value can't hang the function.
      const parsedWait = res.status === 429 ? parseRetryAfterMs(res, errBody) : null;
      const backoffWait = Math.min(1000 * Math.pow(2, attempt), OWN_BACKOFF_CAP_MS);
      let waitMs = Math.min(parsedWait ?? backoffWait, MAX_SINGLE_WAIT_MS);

      // Respect the shared deadline: if we can't afford to wait this long
      // and still do useful work afterward, stop now with a clear error
      // instead of eating into (or blowing past) the platform's own
      // request timeout.
      const remaining = deadline - Date.now();
      if (waitMs > remaining) {
        errors.push(`${model} -> would need to wait ${waitMs}ms for rate limit, but only ${Math.max(0, remaining)}ms left in request budget`);
        logGroqUsage({ label, model, status: res.status, usage: null, retryCount, retryWaitMs });
        return { text: null, usage: null, status: res.status, retryCount, retryWaitMs, rateLimitExhausted: res.status === 429 };
      }

      console.log(
        `Groq ${res.status} on ${model} (${label}), waiting ${waitMs}ms (${parsedWait ? "Groq-specified" : "our backoff"}) before retry ${attempt + 2}/${MAX_RETRIES_PER_MODEL + 1}...`
      );
      retryCount += 1;
      retryWaitMs += waitMs;
      await sleep(waitMs);
      // loop continues -> retries the SAME model, never downgrades here
    } catch (e) {
      errors.push(`${model} -> ${e instanceof Error ? e.message : String(e)} (attempt ${attempt + 1}/${MAX_RETRIES_PER_MODEL + 1})`);
      if (attempt === MAX_RETRIES_PER_MODEL) {
        logGroqUsage({ label, model, status: null, usage: null, retryCount, retryWaitMs });
        return { text: null, usage: null, status: null, retryCount, retryWaitMs, rateLimitExhausted: false };
      }
      const backoffWait = Math.min(1000 * Math.pow(2, attempt), OWN_BACKOFF_CAP_MS);
      const remaining = deadline - Date.now();
      if (backoffWait > remaining) {
        logGroqUsage({ label, model, status: null, usage: null, retryCount, retryWaitMs });
        return { text: null, usage: null, status: null, retryCount, retryWaitMs, rateLimitExhausted: false };
      }
      retryCount += 1;
      retryWaitMs += backoffWait;
      await sleep(backoffWait);
    }
  }

  logGroqUsage({ label, model, status: null, usage: null, retryCount, retryWaitMs });
  return { text: null, usage: null, status: null, retryCount, retryWaitMs, rateLimitExhausted: false };
}

// High-level entry point used by every quality-critical pass. Tries ONLY
// the primary quality model, with its full retry/backoff budget (bounded
// by the shared deadline). Does NOT cascade to the smaller fallback model
// — see "NO SILENT DOWNGRADE" in the file header. `label` identifies the
// pass for usage logging (e.g. "pass1-keywords", "pass2-rewrite") and is
// never sensitive. `deadline` is the shared epoch-ms cutoff for the whole
// request (see index.ts).
export async function callGroqMessages(
  messages: GroqMessage[],
  key: string,
  temperature = 0.3,
  maxTokens = 8192,
  label = "unlabeled",
  deadline: number = Date.now() + REQUEST_DEADLINE_BUDGET_MS
): Promise<string> {
  const errors: string[] = [];

  const primaryResult = await callModelWithRetry(
    messages,
    key,
    PRIMARY_MODEL,
    maxTokens,
    temperature,
    label,
    errors,
    deadline
  );
  if (primaryResult.text) return primaryResult.text;

  if (primaryResult.rateLimitExhausted) {
    console.error(`Groq rate limit exhausted for "${label}" — not downgrading to ${FALLBACK_MODEL}. Errors: ${errors.join(" | ")}`);
    throw new GroqRateLimitError(
      `Resume generation is temporarily rate-limited on our AI provider's account. This keeps quality consistent instead of silently switching to a weaker model — please wait about a minute and try again.`
    );
  }

  console.error(`Groq call failed for "${label}" (non-rate-limit error):`, errors.join(" | "));
  throw new Error(`Groq API request failed. ${errors[0] || "Unknown error"}`);
}

// Convenience wrapper for the common single-user-message case.
export async function callGroq(
  prompt: string,
  key: string,
  temperature = 0.3,
  maxTokens = 8192,
  label = "unlabeled",
  deadline: number = Date.now() + REQUEST_DEADLINE_BUDGET_MS
): Promise<string> {
  return callGroqMessages([{ role: "user", content: prompt }], key, temperature, maxTokens, label, deadline);
}

// Direct single-model call (with retry/backoff, no cascade to a second
// model). Used where a specific model is intentionally chosen up front —
// e.g. the background role/company context lookup, which deliberately
// uses the fast model so it doesn't spend the flagship model's TPM
// budget on non-resume content. This is NOT a live web search — see
// rag/web-search.ts for what this context actually is. Returns null
// (rather than throwing) on failure, since this context is supplementary
// and the pipeline already treats a missing/failed result as non-fatal.
export async function callGroqModel(
  prompt: string,
  key: string,
  model: string,
  temperature = 0.3,
  maxTokens = 2048,
  label = "unlabeled",
  deadline: number = Date.now() + REQUEST_DEADLINE_BUDGET_MS
): Promise<string | null> {
  const errors: string[] = [];
  const result = await callModelWithRetry(
    [{ role: "user", content: prompt }],
    key,
    model,
    maxTokens,
    temperature,
    label,
    errors,
    deadline
  );
  if (!result.text) {
    console.warn(`callGroqModel(${model}, ${label}) failed: ${errors.join(" | ")}`);
  }
  return result.text;
}
