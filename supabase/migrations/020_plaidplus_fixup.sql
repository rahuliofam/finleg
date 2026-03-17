-- ============================================================
-- PlaidPlus Fixup: create brokerage_sync_runs (019 collided with QB sync_runs)
-- and add missing indexes from the partial 019 apply
-- ============================================================

-- The brokerage-specific sync_runs table (separate from QB sync_runs in migration 016)
CREATE TABLE IF NOT EXISTS brokerage_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES institutions(id),

  sync_type TEXT NOT NULL DEFAULT 'manual'
    CHECK (sync_type IN ('scheduled','manual','webhook')),
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','success','partial','error')),
  triggered_by TEXT,

  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,

  -- Counts
  accounts_synced INTEGER DEFAULT 0,
  holdings_synced INTEGER DEFAULT 0,
  transactions_synced INTEGER DEFAULT 0,
  orders_synced INTEGER DEFAULT 0,

  error_message TEXT,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brokerage_sync_runs_status ON brokerage_sync_runs(status, completed_at);
CREATE INDEX IF NOT EXISTS idx_brokerage_sync_runs_institution ON brokerage_sync_runs(institution_id);

ALTER TABLE brokerage_sync_runs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'brokerage_sync_runs' AND policyname = 'Auth read brokerage_sync_runs') THEN
    CREATE POLICY "Auth read brokerage_sync_runs" ON brokerage_sync_runs FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'brokerage_sync_runs' AND policyname = 'Service manage brokerage_sync_runs') THEN
    CREATE POLICY "Service manage brokerage_sync_runs" ON brokerage_sync_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Ensure updated_at trigger exists for brokerage_sync_runs
-- (update_updated_at_column function was created in 019)
DROP TRIGGER IF EXISTS set_updated_at ON brokerage_sync_runs;
-- brokerage_sync_runs has no updated_at column, so skip trigger
