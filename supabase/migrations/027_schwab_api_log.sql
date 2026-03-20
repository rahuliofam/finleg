-- ============================================================
-- 027: Schwab API call audit log
-- Stores every API call with full response for historical record
-- ============================================================

CREATE TABLE IF NOT EXISTS schwab_api_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link to sync run (nullable for standalone API calls)
  sync_run_id UUID REFERENCES brokerage_sync_runs(id) ON DELETE SET NULL,

  -- Link to account (nullable for account-list calls)
  account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,

  -- Request info
  endpoint TEXT NOT NULL,                -- e.g. "/accounts?fields=positions"
  http_method TEXT DEFAULT 'GET',

  -- Response info
  http_status INTEGER,                   -- 200, 401, 403, 500, etc.
  response_body JSONB,                   -- full raw API response
  error_message TEXT,                    -- error text if failed
  rows_returned INTEGER DEFAULT 0,       -- count of items in response

  -- Timing
  queried_at TIMESTAMPTZ DEFAULT now(),  -- when the call was made
  response_time_ms INTEGER,              -- how long the call took

  -- Context
  triggered_by TEXT,                     -- "scheduled", "admin:email", etc.

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schwab_api_log_sync_run ON schwab_api_log(sync_run_id);
CREATE INDEX IF NOT EXISTS idx_schwab_api_log_account ON schwab_api_log(account_id);
CREATE INDEX IF NOT EXISTS idx_schwab_api_log_endpoint ON schwab_api_log(endpoint);
CREATE INDEX IF NOT EXISTS idx_schwab_api_log_queried_at ON schwab_api_log(queried_at DESC);
CREATE INDEX IF NOT EXISTS idx_schwab_api_log_status ON schwab_api_log(http_status);

ALTER TABLE schwab_api_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'schwab_api_log' AND policyname = 'Auth read schwab_api_log') THEN
    CREATE POLICY "Auth read schwab_api_log" ON schwab_api_log FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'schwab_api_log' AND policyname = 'Service manage schwab_api_log') THEN
    CREATE POLICY "Service manage schwab_api_log" ON schwab_api_log FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
