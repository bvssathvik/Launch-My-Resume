// ─────────────────────────────────────────
// gemini-client.ts — [DEPRECATED, NOT IMPORTED] Superseded by providers/ai-provider.ts
// (GeminiProvider with normalized errors, timeouts, and bounded failover).
// Kept only for historical reference. index.ts no longer imports this file.
// ─────────────────────────────────────────

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const MAX_RETRIES = 3;
const OWN_BACKOFF_CAP_MS = 15_000;
const MAX_SINGLE_WAIT_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Single completion via the Gemini generateContent REST endpoint.
 * Throws on terminal failure (like callGroq does) so index.ts can
 * surface a clear message instead of a silent empty resume.
 */
export async function callGemini(
  prompt: string,
  key: string,
  temperature = 0.3,
  maxTokens = 4096,
  label = "unlabeled",
  deadline: number = Date.now() + 110_000
): Promise<string> {
  const model = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";
  const url = `${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(key)}`;

  let lastErr = "";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 20_000) {
      throw new Error(`Gemini "${label}" aborted — request deadline nearly reached.`);
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature, maxOutputTokens: maxTokens },
        }),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });

      if (res.ok) {
        const data = await res.json();
        const text =
          data?.candidates?.[0]?.content?.parts
            ?.map((p: { text?: string }) => p.text || "")
            .join("") || "";
        if (text.trim()) return text;
        lastErr = "empty completion from Gemini";
      } else {
        const bodyText = await res.text().catch(() => "");
        lastErr = `HTTP ${res.status}: ${bodyText.slice(0, 200)}`;

        if (res.status === 429) {
          // Honor retry-after when present, else our own backoff.
          const ra = res.headers.get("retry-after");
          let waitMs = ra ? Math.ceil(parseFloat(ra) * 1000) : NaN;
          if (isNaN(waitMs) || waitMs <= 0) {
            waitMs = Math.min(1000 * Math.pow(2, attempt), OWN_BACKOFF_CAP_MS);
          }
          waitMs = Math.min(waitMs, MAX_SINGLE_WAIT_MS);
          const rem = deadline - Date.now();
          if (waitMs > rem) {
            throw new Error(`Gemini "${label}" rate-limited and no time left in the request to wait.`);
          }
          await sleep(waitMs);
          continue;
        }
        if (res.status >= 500 && attempt < MAX_RETRIES) {
          await sleep(Math.min(1000 * Math.pow(2, attempt), OWN_BACKOFF_CAP_MS));
          continue;
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("aborted")) throw err;
      lastErr = err instanceof Error ? err.message : String(err);
      if (attempt === MAX_RETRIES) break;
      await sleep(Math.min(1000 * Math.pow(2, attempt), OWN_BACKOFF_CAP_MS));
      continue;
    }

    if (attempt < MAX_RETRIES) {
      await sleep(Math.min(1000 * Math.pow(2, attempt), OWN_BACKOFF_CAP_MS));
    }
  }

  throw new Error(`Gemini API request failed for "${label}". ${lastErr}`);
}
