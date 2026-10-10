// ─────────────────────────────────────────
// test/failover.test.ts — Mock-based failover & idempotency tests
//
// No real API keys or network calls. Stubs globalThis.fetch to simulate
// Gemini/Groq responses (success, 429, 5xx, timeout-like, malformed JSON)
// and exercises the REAL orchestration code in providers/ai-provider.ts
// and jobs-registry.ts.
// ─────────────────────────────────────────

// Minimal local assertions (avoids a remote deno.land/std dependency so
// this test suite runs in network-restricted CI/sandbox environments too).
function assertEquals(actual: unknown, expected: unknown, msg?: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(msg || `assertEquals failed: ${a} !== ${e}`);
}
function assert(cond: unknown, msg?: string): asserts cond {
  if (!cond) throw new Error(msg || "assertion failed");
}

import { runAIPhase } from "../providers/ai-provider.ts";
import { AIError } from "../providers/errors.ts";
import { createRegistry, newJob, classifyExisting, type JobRecord } from "../jobs-registry.ts";

const ORIGINAL_FETCH = globalThis.fetch;

function setEnv() {
  Deno.env.set("GEMINI_API_KEY", "test-gemini-key");
  Deno.env.set("GROQ_API_KEY", "test-groq-key");
}

function mockFetch(handler: (url: string) => { status: number; body: unknown; headers?: Record<string, string> }) {
  // deno-lint-ignore no-explicit-any
  globalThis.fetch = (async (input: any) => {
    const url = typeof input === "string" ? input : input.url;
    const { status, body, headers } = handler(url);
    return new Response(JSON.stringify(body), { status, headers: headers || {} });
  }) as typeof fetch;
}

function geminiOk(text: string) {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}
function groqOk(text: string) {
  return { choices: [{ message: { content: text } }] };
}

function baseOpts(overrides: Partial<Parameters<typeof runAIPhase>[0]> = {}) {
  return {
    generationId: "test-gen-id",
    phase: 1,
    name: "test-phase",
    prompt: "test prompt",
    temperature: 0.1,
    maxTokens: 100,
    deadline: Date.now() + 30_000,
    defaultProvider: "gemini" as const,
    fallbackProvider: "groq" as const,
    jsonMode: true,
    ...overrides,
  };
}

Deno.test("Gemini success, no fallback needed", async () => {
  setEnv();
  mockFetch((url) => {
    if (url.includes("generativelanguage")) return { status: 200, body: geminiOk('{"ok":true}') };
    throw new Error("should not call Groq");
  });
  const r = await runAIPhase(baseOpts());
  assertEquals(r.providerUsed, "gemini");
  assertEquals((r.parsed as { ok: boolean }).ok, true);
  globalThis.fetch = ORIGINAL_FETCH;
});

Deno.test("Provider payload uses current Groq chat fields", async () => {
  setEnv();
  let payload: Record<string, unknown> | undefined;
  mockFetch((url) => {
    if (url.includes("groq.com")) {
      return {
        status: 200,
        body: groqOk('{"ok":true}'),
      };
    }
    throw new Error(`unexpected url: ${url}`);
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("groq.com")) payload = JSON.parse(String(init?.body));
    return originalFetch(input, init);
  }) as typeof fetch;
  const r = await runAIPhase(baseOpts({ defaultProvider: "groq", fallbackProvider: null }));
  assertEquals(r.providerUsed, "groq");
  assertEquals(payload?.model, "openai/gpt-oss-120b");
  assertEquals(payload?.temperature, 0.1);
  assertEquals(payload?.max_completion_tokens, 100);
  assertEquals(payload?.messages, [{ role: "user", content: "test prompt" }]);
  assertEquals(payload?.response_format, { type: "json_object" });
  globalThis.fetch = ORIGINAL_FETCH;
});

Deno.test("Gemini 429 -> Groq fallback", async () => {
  setEnv();
  mockFetch((url) => {
    if (url.includes("generativelanguage")) return { status: 429, body: { error: "rate limited" } };
    if (url.includes("groq.com")) return { status: 200, body: groqOk('{"ok":true}') };
    throw new Error("unexpected url");
  });
  const r = await runAIPhase(baseOpts());
  assertEquals(r.providerUsed, "groq");
  globalThis.fetch = ORIGINAL_FETCH;
});

Deno.test("Groq 429 -> Gemini fallback (phase 3/4 direction)", async () => {
  setEnv();
  mockFetch((url) => {
    if (url.includes("groq.com")) return { status: 429, body: { error: "rate limited" } };
    if (url.includes("generativelanguage")) return { status: 200, body: geminiOk('{"ok":true}') };
    throw new Error("unexpected url");
  });
  const r = await runAIPhase(baseOpts({ defaultProvider: "groq", fallbackProvider: "gemini" }));
  assertEquals(r.providerUsed, "gemini");
  globalThis.fetch = ORIGINAL_FETCH;
});

Deno.test("Gemini timeout (simulated via 504) -> Groq fallback", async () => {
  setEnv();
  mockFetch((url) => {
    if (url.includes("generativelanguage")) return { status: 504, body: { error: "timeout" } };
    if (url.includes("groq.com")) return { status: 200, body: groqOk('{"ok":true}') };
    throw new Error("unexpected url");
  });
  const r = await runAIPhase(baseOpts());
  assertEquals(r.providerUsed, "groq");
  globalThis.fetch = ORIGINAL_FETCH;
});

Deno.test("Invalid Gemini JSON -> repaired on same provider, no fallback needed", async () => {
  setEnv();
  let call = 0;
  mockFetch((url) => {
    if (url.includes("generativelanguage")) {
      call++;
      return call === 1
        ? { status: 200, body: geminiOk("not json at all") }
        : { status: 200, body: geminiOk('{"ok":true}') };
    }
    throw new Error("should not call Groq");
  });
  const r = await runAIPhase(baseOpts());
  assertEquals(r.providerUsed, "gemini");
  assertEquals(r.repaired, true);
  globalThis.fetch = ORIGINAL_FETCH;
});

Deno.test("Invalid Gemini JSON (unrepairable) -> Groq fallback", async () => {
  setEnv();
  mockFetch((url) => {
    if (url.includes("generativelanguage")) return { status: 200, body: geminiOk("still not json") };
    if (url.includes("groq.com")) return { status: 200, body: groqOk('{"ok":true}') };
    throw new Error("unexpected url");
  });
  const r = await runAIPhase(baseOpts());
  assertEquals(r.providerUsed, "groq");
  globalThis.fetch = ORIGINAL_FETCH;
});

Deno.test("Both providers 401 -> PROVIDER_AUTH_FAILED, bounded attempts", async () => {
  setEnv();
  let attempts = 0;
  mockFetch((_url) => {
    attempts++;
    return { status: 401, body: { error: "bad key" } };
  });
  try {
    await runAIPhase(baseOpts());
    throw new Error("expected throw");
  } catch (e) {
    assert(e instanceof AIError);
    assertEquals((e as AIError).type, "PROVIDER_AUTH_FAILED");
    // auth failures skip repair retries -> exactly 2 attempts (one per provider)
    assertEquals(attempts, 2);
  }
  globalThis.fetch = ORIGINAL_FETCH;
});

Deno.test("Both providers 500 -> PROVIDER_SERVER_ERROR, never infinite loop", async () => {
  setEnv();
  let attempts = 0;
  mockFetch((_url) => {
    attempts++;
    return { status: 500, body: { error: "server error" } };
  });
  try {
    await runAIPhase(baseOpts());
    throw new Error("expected throw");
  } catch (e) {
    assert(e instanceof AIError);
    assertEquals((e as AIError).type, "PROVIDER_SERVER_ERROR");
    assert(attempts <= 4, `expected bounded attempts, got ${attempts}`);
  }
  globalThis.fetch = ORIGINAL_FETCH;
});

Deno.test("Both providers 429 -> PROVIDER_RATE_LIMITED", async () => {
  setEnv();
  mockFetch((_url) => ({ status: 429, body: { error: "rate limited" } }));
  try {
    await runAIPhase(baseOpts());
    throw new Error("expected throw");
  } catch (e) {
    assert(e instanceof AIError);
    assertEquals((e as AIError).type, "PROVIDER_RATE_LIMITED");
  }
  globalThis.fetch = ORIGINAL_FETCH;
});

Deno.test("jobs-registry: generation_id classification", () => {
  const base: JobRecord = newJob("abc-123");
  assertEquals(classifyExisting(null), "fresh");
  assertEquals(classifyExisting({ ...base, status: "RUNNING", updated_at: Date.now() }), "in_progress");
  assertEquals(classifyExisting({ ...base, status: "COMPLETED", result: { ok: true } }), "replay");
  assertEquals(classifyExisting({ ...base, status: "FAILED" }), "retry_failed");
  // stale RUNNING (no update in a long time) should allow retry, not wedge forever
  assertEquals(classifyExisting({ ...base, status: "RUNNING", updated_at: Date.now() - 10 * 60 * 1000 }), "retry_failed");
});

Deno.test("jobs-registry: save -> load round trip via registry", async () => {
  const store = new Map<string, JobRecord>();
  const registry = createRegistry({
    load: async (id: string) => store.get(id) || null,
    save: async (job: JobRecord) => { store.set(job.generation_id, job); },
  });
  const job = newJob("test-id-2");
  await registry.save(job);
  const loaded = await registry.load("test-id-2");
  assert(loaded);
  assertEquals(loaded!.generation_id, "test-id-2");
  assertEquals(loaded!.status, "RUNNING");
});
