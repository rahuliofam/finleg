-- QuickBooks integration + receipt workflow tables
-- Phase 1: Receipt ingestion, QB transaction sync, auto-matching, categorization
-- ============================================================

-- ============================================================
-- QB OAuth Tokens (single-row per company)
-- ============================================================
CREATE TABLE IF NOT EXISTS qb_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  realm_id TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_type TEXT DEFAULT 'bearer',
  expires_at TIMESTAMPTZ NOT NULL,
  refresh_expires_at TIMESTAMPTZ NOT NULL,
  company_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE qb_tokens ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'qb_tokens' AND policyname = 'Service manage qb_tokens') THEN
    CREATE POLICY "Service manage qb_tokens" ON qb_tokens FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- QB Transactions (synced from QuickBooks Online API)
-- ============================================================
CREATE TABLE IF NOT EXISTS qb_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- QB identifiers
  qb_id TEXT NOT NULL,
  qb_type TEXT NOT NULL,            -- 'Purchase', 'Deposit', 'Transfer', 'JournalEntry', etc.
  qb_account_name TEXT,             -- Bank/CC account in QB
  qb_account_id TEXT,

  -- Transaction data
  txn_date DATE NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  vendor_name TEXT,
  description TEXT,
  memo TEXT,

  -- Categorization
  qb_category_name TEXT,            -- Category as set in QB
  qb_category_id TEXT,
  our_category TEXT,                 -- Our override/AI-assigned category
  category_confidence NUMERIC(3,2), -- 0.00-1.00 AI confidence score
  category_source TEXT,              -- 'qb', 'rule', 'ai', 'human'

  -- Matching
  receipt_id UUID,                   -- FK set after matching
  match_confidence NUMERIC(3,2),

  -- Review workflow
  review_status TEXT DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'auto_categorized', 'needs_review', 'approved', 'bookkeeper')),
  reviewed_by TEXT,                  -- 'owner', 'bookkeeper', 'ai'
  reviewed_at TIMESTAMPTZ,

  -- Sync metadata
  synced_at TIMESTAMPTZ DEFAULT now(),
  qb_last_modified TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(qb_id, qb_type)
);

CREATE INDEX IF NOT EXISTS idx_qb_txn_date ON qb_transactions(txn_date);
CREATE INDEX IF NOT EXISTS idx_qb_txn_vendor ON qb_transactions(vendor_name);
CREATE INDEX IF NOT EXISTS idx_qb_txn_review ON qb_transactions(review_status);
CREATE INDEX IF NOT EXISTS idx_qb_txn_receipt ON qb_transactions(receipt_id);
CREATE INDEX IF NOT EXISTS idx_qb_txn_amount_date ON qb_transactions(amount, txn_date);

ALTER TABLE qb_transactions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'qb_transactions' AND policyname = 'Authenticated read qb_txns') THEN
    CREATE POLICY "Authenticated read qb_txns" ON qb_transactions FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'qb_transactions' AND policyname = 'Service write qb_txns') THEN
    CREATE POLICY "Service write qb_txns" ON qb_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'qb_transactions' AND policyname = 'Authenticated update qb_txns') THEN
    CREATE POLICY "Authenticated update qb_txns" ON qb_transactions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- Receipts (from email ingestion)
-- ============================================================
CREATE TABLE IF NOT EXISTS receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Email source
  email_from TEXT,
  email_subject TEXT,
  email_date TIMESTAMPTZ,
  email_id TEXT,                     -- Resend email ID

  -- Attachment storage
  attachment_url TEXT,               -- R2 URL
  attachment_filename TEXT,
  attachment_content_type TEXT,

  -- AI-parsed data
  parsed_vendor TEXT,
  parsed_amount NUMERIC(12,2),
  parsed_date DATE,
  parsed_category TEXT,
  parsed_line_items JSONB,          -- [{description, amount, quantity}]
  parsed_tax NUMERIC(12,2),
  parsed_payment_method TEXT,
  ai_confidence NUMERIC(3,2),
  ai_raw_response JSONB,            -- Full Claude response for debugging

  -- User-provided data (from email subject/body)
  user_category TEXT,                -- Category hint from email subject
  user_notes TEXT,

  -- Matching
  matched_qb_txn_id UUID REFERENCES qb_transactions(id),
  match_confidence NUMERIC(3,2),
  match_method TEXT,                 -- 'exact_amount', 'fuzzy', 'manual', 'ai'

  -- Status
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'parsed', 'matched', 'review', 'archived', 'error')),
  error_message TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_receipts_status ON receipts(status);
CREATE INDEX IF NOT EXISTS idx_receipts_amount_date ON receipts(parsed_amount, parsed_date);
CREATE INDEX IF NOT EXISTS idx_receipts_matched ON receipts(matched_qb_txn_id);

ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'receipts' AND policyname = 'Authenticated read receipts') THEN
    CREATE POLICY "Authenticated read receipts" ON receipts FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'receipts' AND policyname = 'Service write receipts') THEN
    CREATE POLICY "Service write receipts" ON receipts FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'receipts' AND policyname = 'Authenticated update receipts') THEN
    CREATE POLICY "Authenticated update receipts" ON receipts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Add FK from qb_transactions back to receipts
ALTER TABLE qb_transactions
  ADD CONSTRAINT fk_qb_txn_receipt FOREIGN KEY (receipt_id) REFERENCES receipts(id);

-- ============================================================
-- Category Rules (learning system)
-- ============================================================
CREATE TABLE IF NOT EXISTS category_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_pattern TEXT NOT NULL,       -- Vendor name pattern (case-insensitive match)
  match_type TEXT DEFAULT 'contains'
    CHECK (match_type IN ('exact', 'contains', 'starts_with', 'regex')),
  category TEXT NOT NULL,
  priority INTEGER DEFAULT 0,        -- Higher = checked first
  created_by TEXT,                   -- 'seed', 'owner', 'bookkeeper', 'ai'
  hit_count INTEGER DEFAULT 0,       -- How many times this rule was applied
  last_hit_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_category_rules_active ON category_rules(is_active, priority DESC);

ALTER TABLE category_rules ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'category_rules' AND policyname = 'Authenticated read category_rules') THEN
    CREATE POLICY "Authenticated read category_rules" ON category_rules FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'category_rules' AND policyname = 'Service write category_rules') THEN
    CREATE POLICY "Service write category_rules" ON category_rules FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'category_rules' AND policyname = 'Authenticated manage category_rules') THEN
    CREATE POLICY "Authenticated manage category_rules" ON category_rules FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- Activity Log (audit trail of AI + human actions)
-- ============================================================
CREATE TABLE IF NOT EXISTS bookkeeping_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,              -- 'receipt_parsed', 'auto_categorized', 'manual_categorized',
                                     -- 'receipt_matched', 'txn_synced', 'rule_created', 'review_approved'
  entity_type TEXT,                  -- 'receipt', 'qb_transaction', 'category_rule'
  entity_id UUID,
  actor TEXT,                        -- 'ai', 'owner', 'bookkeeper', 'system'
  details JSONB,                     -- Action-specific metadata
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_created ON bookkeeping_activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_entity ON bookkeeping_activity_log(entity_type, entity_id);

ALTER TABLE bookkeeping_activity_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bookkeeping_activity_log' AND policyname = 'Authenticated read activity_log') THEN
    CREATE POLICY "Authenticated read activity_log" ON bookkeeping_activity_log FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bookkeeping_activity_log' AND policyname = 'Service write activity_log') THEN
    CREATE POLICY "Service write activity_log" ON bookkeeping_activity_log FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
