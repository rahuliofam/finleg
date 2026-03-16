-- Backup activity log — populated by backup scripts on Hostinger and Alpaca Mac
CREATE TABLE IF NOT EXISTS backup_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL,         -- 'hostinger' or 'alpaca-mac'
  backup_type TEXT NOT NULL,    -- 'db-to-r2', 'r2-to-rvault'
  status TEXT NOT NULL DEFAULT 'success', -- 'success' or 'error'
  duration_seconds INTEGER,
  details JSONB,                -- flexible: file counts, sizes, errors, etc.
  r2_key TEXT                   -- e.g. 'db-backups/full-20260316-182120.sql.gz'
);

-- Index for listing recent backups
CREATE INDEX idx_backup_logs_created ON backup_logs (created_at DESC);

-- RLS: authenticated users can read, service role can insert
ALTER TABLE backup_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view backup logs"
  ON backup_logs FOR SELECT
  TO authenticated
  USING (true);

-- Allow inserts via anon key with a simple shared secret header
-- (backup scripts will use the service role key directly)
CREATE POLICY "Service role can insert backup logs"
  ON backup_logs FOR INSERT
  TO service_role
  WITH CHECK (true);
