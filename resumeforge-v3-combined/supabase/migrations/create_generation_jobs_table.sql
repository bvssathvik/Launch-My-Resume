-- create_generation_jobs_table.sql
-- Idempotency store for the four-phase resume pipeline.
-- One row per generation_id (client-supplied UUID). Lets the Edge
-- Function recognize a duplicate submission (double-click, retried
-- network request, resent generation_id) and avoid re-running phases
-- or generating a duplicate resume.

CREATE TABLE IF NOT EXISTS generation_jobs (
  generation_id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  record jsonb NOT NULL,          -- full JobRecord (status, per-phase status/provider)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE generation_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_own_generation_jobs" ON generation_jobs
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "insert_own_generation_jobs" ON generation_jobs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "update_own_generation_jobs" ON generation_jobs
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS generation_jobs_user_idx ON generation_jobs(user_id);
CREATE INDEX IF NOT EXISTS generation_jobs_updated_idx ON generation_jobs(updated_at DESC);
