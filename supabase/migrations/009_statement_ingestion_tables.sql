-- Statement ingestion tables for Phase 1: Credit Cards + Checking
-- These tables store parsed transaction data from PDF statements

-- ============================================================
-- Credit Card Statement Summaries
-- ============================================================
CREATE TABLE IF NOT EXISTS cc_statement_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link to source document
  document_id UUID REFERENCES document_index(id),
  institution TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_number TEXT,
  account_holder TEXT,

  -- Statement period
  statement_date DATE NOT NULL,
  period_start DATE,
  period_end DATE,

  -- Summary amounts
  previous_balance NUMERIC(12,2),
  payments_credits NUMERIC(12,2),
  new_charges NUMERIC(12,2),
  fees NUMERIC(12,2),
  interest_charged NUMERIC(12,2),
  new_balance NUMERIC(12,2),
  minimum_due NUMERIC(12,2),
  payment_due_date DATE,
  credit_limit NUMERIC(12,2),
  available_credit NUMERIC(12,2),

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cc_summary_doc ON cc_statement_summaries(document_id);

ALTER TABLE cc_statement_summaries ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'cc_statement_summaries' AND policyname = 'Authenticated read cc_summaries') THEN
    CREATE POLICY "Authenticated read cc_summaries" ON cc_statement_summaries FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'cc_statement_summaries' AND policyname = 'Service write cc_summaries') THEN
    CREATE POLICY "Service write cc_summaries" ON cc_statement_summaries FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- Credit Card Transactions
-- ============================================================
CREATE TABLE IF NOT EXISTS cc_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link to statement
  summary_id UUID REFERENCES cc_statement_summaries(id) ON DELETE CASCADE,
  document_id UUID REFERENCES document_index(id),

  -- Source tagging (denormalized)
  institution TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_number TEXT,
  account_holder TEXT,
  statement_date DATE NOT NULL,

  -- Transaction data
  transaction_date DATE NOT NULL,
  posting_date DATE,
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,  -- positive = charge, negative = credit/payment
  reference_number TEXT,
  category TEXT,
  daily_cash NUMERIC(8,2),        -- Apple Card Daily Cash
  foreign_spend_amount NUMERIC(12,2),  -- Amex/Robinhood foreign currency amount
  foreign_spend_currency TEXT,    -- e.g. 'Indian Rupees', 'TH BAHT'

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cc_txn_summary ON cc_transactions(summary_id);
CREATE INDEX IF NOT EXISTS idx_cc_txn_institution ON cc_transactions(institution);
CREATE INDEX IF NOT EXISTS idx_cc_txn_date ON cc_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_cc_txn_stmt_date ON cc_transactions(statement_date);

ALTER TABLE cc_transactions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'cc_transactions' AND policyname = 'Authenticated read cc_txns') THEN
    CREATE POLICY "Authenticated read cc_txns" ON cc_transactions FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'cc_transactions' AND policyname = 'Service write cc_txns') THEN
    CREATE POLICY "Service write cc_txns" ON cc_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- Checking Statement Summaries
-- ============================================================
CREATE TABLE IF NOT EXISTS checking_statement_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link to source document
  document_id UUID REFERENCES document_index(id),
  institution TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_number TEXT,
  account_holder TEXT,

  -- Statement period
  statement_date DATE NOT NULL,
  period_start DATE,
  period_end DATE,

  -- Summary amounts
  beginning_balance NUMERIC(12,2),
  total_deposits NUMERIC(12,2),
  total_withdrawals NUMERIC(12,2),
  fees NUMERIC(12,2),
  interest_earned NUMERIC(12,2),
  ending_balance NUMERIC(12,2),

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chk_summary_doc ON checking_statement_summaries(document_id);

ALTER TABLE checking_statement_summaries ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'checking_statement_summaries' AND policyname = 'Authenticated read chk_summaries') THEN
    CREATE POLICY "Authenticated read chk_summaries" ON checking_statement_summaries FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'checking_statement_summaries' AND policyname = 'Service write chk_summaries') THEN
    CREATE POLICY "Service write chk_summaries" ON checking_statement_summaries FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- Checking Transactions
-- ============================================================
CREATE TABLE IF NOT EXISTS checking_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link to statement
  summary_id UUID REFERENCES checking_statement_summaries(id) ON DELETE CASCADE,
  document_id UUID REFERENCES document_index(id),

  -- Source tagging (denormalized)
  institution TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_number TEXT,
  account_holder TEXT,
  statement_date DATE NOT NULL,

  -- Transaction data
  transaction_date DATE NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,  -- positive = deposit, negative = withdrawal
  running_balance NUMERIC(12,2),
  check_number TEXT,
  transaction_type TEXT,          -- 'deposit', 'withdrawal', 'transfer', 'fee', 'interest', 'check'
  ref_number TEXT,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chk_txn_summary ON checking_transactions(summary_id);
CREATE INDEX IF NOT EXISTS idx_chk_txn_institution ON checking_transactions(institution);
CREATE INDEX IF NOT EXISTS idx_chk_txn_date ON checking_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_chk_txn_stmt_date ON checking_transactions(statement_date);

ALTER TABLE checking_transactions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'checking_transactions' AND policyname = 'Authenticated read chk_txns') THEN
    CREATE POLICY "Authenticated read chk_txns" ON checking_transactions FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'checking_transactions' AND policyname = 'Service write chk_txns') THEN
    CREATE POLICY "Service write chk_txns" ON checking_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
