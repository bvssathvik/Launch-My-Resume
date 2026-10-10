// ─────────────────────────────────────────
// jobs-registry.ts — generation_id state machine + idempotency
//
// One row per generation_id. Each phase transitions PENDING -> RUNNING ->
// COMPLETED | FAILED. Once a phase is COMPLETED it is never re-run for
// that generation_id. If the SAME generation_id is submitted again:
//   - job COMPLETED  -> replay the stored final result, run nothing.
//   - job RUNNING     -> reject with 409 (another request is already
//                        processing this exact job; this is what stops
//                        double-click and duplicate frontend submits from
//                        starting a second generation).
//   - job FAILED      -> the user explicitly retried; allow a fresh run.
//   - stale RUNNING   -> (crashed instance, no completion after N minutes)
//                        allow a fresh run rather than wedging forever.
//   - no record       -> fresh run.
//
// Persisted to the `generation_jobs` Supabase table (see migrations/) so
// idempotency survives across Edge Function instances; falls back to an
// in-memory map within a single instance if the table/DB call fails, so
// the pipeline still degrades gracefully rather than hard-failing.
// ─────────────────────────────────────────

export type PhaseStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

export interface JobRecord {
  generation_id: string;
  status: "RUNNING" | "COMPLETED" | "FAILED";
  phases: Record<number, { status: PhaseStatus; provider?: "gemini" | "groq" }>;
  result?: unknown; // the full GenerateResponse, stored once COMPLETED
  created_at: number;
  updated_at: number;
}

const RUNNING_STALE_MS = 4 * 60 * 1000; // a RUNNING job with no update in 4 min is treated as crashed

// In-memory fallback (per Edge Function instance — best-effort only).
const memStore = new Map<string, JobRecord>();

export interface RegistryDeps {
  load: (generationId: string) => Promise<JobRecord | null>;
  save: (job: JobRecord) => Promise<void>;
}

export function createRegistry(deps: RegistryDeps) {
  return {
    async load(generationId: string): Promise<JobRecord | null> {
      try {
        const fromDb = await deps.load(generationId);
        if (fromDb) return fromDb;
      } catch (e) {
        console.warn(`jobs-registry: DB load failed, falling back to in-memory: ${e instanceof Error ? e.message : String(e)}`);
      }
      return memStore.get(generationId) || null;
    },
    async save(job: JobRecord): Promise<void> {
      memStore.set(job.generation_id, job);
      try {
        await deps.save(job);
      } catch (e) {
        console.warn(`jobs-registry: DB save failed (kept in-memory only): ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}

/** Classifies an existing job record for the "is this a duplicate?" check. */
export function classifyExisting(job: JobRecord | null): "fresh" | "replay" | "in_progress" | "retry_failed" {
  if (!job) return "fresh";
  if (job.status === "COMPLETED") return "replay";
  if (job.status === "RUNNING" && Date.now() - job.updated_at < RUNNING_STALE_MS) return "in_progress";
  // FAILED (or stale RUNNING) -> the user explicitly re-submits -> allow a fresh run
  return "retry_failed";
}

export function newJob(generationId: string): JobRecord {
  const now = Date.now();
  return {
    generation_id: generationId,
    status: "RUNNING",
    phases: {
      1: { status: "PENDING" },
      2: { status: "PENDING" },
      3: { status: "PENDING" },
      4: { status: "PENDING" },
    },
    created_at: now,
    updated_at: now,
  };
}
