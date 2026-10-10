-- create_conversations_table.sql
-- Stores the LaunchMyCV sidebar history for each signed-in user.

CREATE TABLE IF NOT EXISTS conversations (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title            TEXT NOT NULL,
  job_title        TEXT DEFAULT '',
  company          TEXT DEFAULT '',
  template_name    TEXT DEFAULT '',
  resume_file_name TEXT DEFAULT '',
  job_description  TEXT DEFAULT '',
  linkedin_url     TEXT DEFAULT '',
  status           TEXT DEFAULT 'draft',
  scores           JSONB DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conversations_read_own"
  ON conversations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "conversations_insert_own"
  ON conversations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "conversations_update_own"
  ON conversations FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "conversations_delete_own"
  ON conversations FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS conversations_user_id_idx ON conversations(user_id);
CREATE INDEX IF NOT EXISTS conversations_updated_idx ON conversations(updated_at DESC);
