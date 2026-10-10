-- create_resumes_table.sql
-- Run in Supabase → SQL Editor → New Query → Paste → Run

CREATE TABLE IF NOT EXISTS resumes (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  job_title        TEXT NOT NULL,
  resume_text      TEXT NOT NULL,
  latex_code       TEXT DEFAULT '',
  pdf_available    BOOLEAN DEFAULT false,
  docx_available   BOOLEAN DEFAULT false,
  ats_score        INTEGER DEFAULT 0,
  ai_risk_score    INTEGER DEFAULT 0,
  rag_trust_score  INTEGER DEFAULT 0,
  ats_target       TEXT DEFAULT 'generic',
  linkedin_flags   JSONB DEFAULT '[]',
  rag_flags        JSONB DEFAULT '[]',
  format           TEXT DEFAULT 'sb2nov',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE resumes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_own"   ON resumes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "insert_own" ON resumes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own" ON resumes FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS resumes_user_id_idx ON resumes(user_id);
CREATE INDEX IF NOT EXISTS resumes_created_idx ON resumes(created_at DESC);
