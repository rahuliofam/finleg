-- Phase 2 Statement Ingestion Tables
-- Covers: brokerage, IRA, crypto, HELOC, auto-loan, mortgage, credit-line
-- Credit-line reuses cc_* tables (identical format)
-- Closed accounts reuse cc_*/checking_* tables

-- ============================================================
-- Investment Statement Summaries (Brokerage + IRA)
-- ============================================================
CREATE TABLE IF NOT EXISTS investment_statement_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  document_id UUID REFERENCES document_index(id),
  institution TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_number TEXT,
  account_holder TEXT,

  -- Statement period
  statement_date DATE NOT NULL,
  period_start DATE,
  period_end DATE,

  -- Portfolio value
  starting_value NUMERIC(14,2),
  ending_value NUMERIC(14,2),
  total_change_dollars NUMERIC(14,2),
  total_change_pct NUMERIC(8,4),

  -- Cash flow
  credits NUMERIC(14,2),
  debits NUMERIC(14,2),
  transfers_in NUMERIC(14,2),
  transfers_out NUMERIC(14,2),
  income_reinvested NUMERIC(14,2),
  change_in_value NUMERIC(14,2),

  -- Cash
  starting_cash NUMERIC(14,2),
  ending_cash NUMERIC(14,2),

  -- Income
  total_income NUMERIC(14,2),
  bank_sweep_interest NUMERIC(14,2),
  dividends NUMERIC(14,2),
  capital_gains_distributions NUMERIC(14,2),
  interest_earned NUMERIC(14,2),

  -- Gains
  realized_gain_loss_short NUMERIC(14,2),
  realized_gain_loss_long NUMERIC(14,2),
  unrealized_gain_loss NUMERIC(14,2),

  -- Margin (brokerage only)
  margin_loan_balance NUMERIC(14,2),
  margin_loan_rate NUMERIC(6,4),

  -- IRA contribution tracking
  contribution_type TEXT,        -- 'Traditional', 'Roth', etc.
  prior_year_ytd NUMERIC(14,2),
  current_year_ytd NUMERIC(14,2),

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_summary_doc ON investment_statement_summaries(document_id);
CREATE INDEX IF NOT EXISTS idx_inv_summary_inst ON investment_statement_summaries(institution);
CREATE INDEX IF NOT EXISTS idx_inv_summary_date ON investment_statement_summaries(statement_date);

ALTER TABLE investment_statement_summaries ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'investment_statement_summaries' AND policyname = 'Authenticated read inv_summaries') THEN
    CREATE POLICY "Authenticated read inv_summaries" ON investment_statement_summaries FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'investment_statement_summaries' AND policyname = 'Service write inv_summaries') THEN
    CREATE POLICY "Service write inv_summaries" ON investment_statement_summaries FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- Holdings Snapshots (Brokerage + IRA + Crypto)
-- ============================================================
CREATE TABLE IF NOT EXISTS holdings_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  summary_id UUID REFERENCES investment_statement_summaries(id) ON DELETE CASCADE,
  document_id UUID REFERENCES document_index(id),

  institution TEXT NOT NULL,
  account_name TEXT NOT NULL,
  statement_date DATE NOT NULL,

  -- Security info
  security_name TEXT NOT NULL,
  ticker_symbol TEXT,
  cusip TEXT,
  asset_class TEXT,            -- 'equity', 'fixed_income', 'option', 'crypto', 'cash_equivalent', 'etf', 'mutual_fund'

  -- Position
  quantity NUMERIC(18,8),      -- high precision for crypto
  market_price NUMERIC(14,4),
  market_value NUMERIC(14,2),
  cost_basis NUMERIC(14,2),
  unrealized_gain_loss NUMERIC(14,2),

  -- Allocation
  pct_of_account NUMERIC(6,2),
  estimated_yield NUMERIC(6,4),
  estimated_annual_income NUMERIC(14,2),
  marginable BOOLEAN,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_holdings_summary ON holdings_snapshots(summary_id);
CREATE INDEX IF NOT EXISTS idx_holdings_date ON holdings_snapshots(statement_date);
CREATE INDEX IF NOT EXISTS idx_holdings_ticker ON holdings_snapshots(ticker_symbol);

ALTER TABLE holdings_snapshots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'holdings_snapshots' AND policyname = 'Authenticated read holdings') THEN
    CREATE POLICY "Authenticated read holdings" ON holdings_snapshots FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'holdings_snapshots' AND policyname = 'Service write holdings') THEN
    CREATE POLICY "Service write holdings" ON holdings_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- Investment Transactions (Brokerage + IRA + Crypto)
-- ============================================================
CREATE TABLE IF NOT EXISTS investment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  summary_id UUID REFERENCES investment_statement_summaries(id) ON DELETE CASCADE,
  document_id UUID REFERENCES document_index(id),

  institution TEXT NOT NULL,
  account_name TEXT NOT NULL,
  statement_date DATE NOT NULL,

  -- Transaction data
  trade_date DATE,
  settle_date DATE,
  transaction_type TEXT,       -- 'Buy', 'Sell', 'Reinvest', 'Dividend', 'Interest', 'Transfer', 'Convert', 'Rewards', 'Fee'
  description TEXT NOT NULL,
  security_name TEXT,
  ticker_symbol TEXT,

  -- Amounts
  quantity NUMERIC(18,8),
  unit_price NUMERIC(14,4),
  charges_and_interest NUMERIC(12,2),
  subtotal NUMERIC(14,2),      -- pre-fee amount (crypto)
  total_amount NUMERIC(14,2),
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_txn_summary ON investment_transactions(summary_id);
CREATE INDEX IF NOT EXISTS idx_inv_txn_date ON investment_transactions(trade_date);
CREATE INDEX IF NOT EXISTS idx_inv_txn_ticker ON investment_transactions(ticker_symbol);

ALTER TABLE investment_transactions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'investment_transactions' AND policyname = 'Authenticated read inv_txns') THEN
    CREATE POLICY "Authenticated read inv_txns" ON investment_transactions FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'investment_transactions' AND policyname = 'Service write inv_txns') THEN
    CREATE POLICY "Service write inv_txns" ON investment_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- Realized Gain/Loss (Brokerage + IRA)
-- ============================================================
CREATE TABLE IF NOT EXISTS realized_gain_loss (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  summary_id UUID REFERENCES investment_statement_summaries(id) ON DELETE CASCADE,
  document_id UUID REFERENCES document_index(id),

  institution TEXT NOT NULL,
  account_name TEXT NOT NULL,
  statement_date DATE NOT NULL,

  security_name TEXT NOT NULL,
  ticker_symbol TEXT,
  quantity NUMERIC(18,8),
  acquired_date DATE,
  sold_date DATE,
  proceeds NUMERIC(14,2),
  cost_basis NUMERIC(14,2),
  gain_loss NUMERIC(14,2),
  term TEXT,                   -- 'short', 'long'

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rgl_summary ON realized_gain_loss(summary_id);

ALTER TABLE realized_gain_loss ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'realized_gain_loss' AND policyname = 'Authenticated read rgl') THEN
    CREATE POLICY "Authenticated read rgl" ON realized_gain_loss FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'realized_gain_loss' AND policyname = 'Service write rgl') THEN
    CREATE POLICY "Service write rgl" ON realized_gain_loss FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- Loan Statement Summaries (HELOC + Auto Loan + Mortgage)
-- ============================================================
CREATE TABLE IF NOT EXISTS loan_statement_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  document_id UUID REFERENCES document_index(id),
  institution TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_number TEXT,
  account_holder TEXT,
  loan_type TEXT NOT NULL,     -- 'heloc', 'auto-loan', 'mortgage'

  -- Statement period
  statement_date DATE NOT NULL,
  period_start DATE,
  period_end DATE,

  -- Balances
  principal_balance NUMERIC(14,2),
  interest_rate NUMERIC(6,4),
  credit_limit NUMERIC(14,2),     -- HELOC
  available_credit NUMERIC(14,2), -- HELOC

  -- Payment info
  total_payment_due NUMERIC(14,2),
  minimum_payment NUMERIC(14,2),
  payment_due_date DATE,
  principal_portion NUMERIC(14,2),
  interest_portion NUMERIC(14,2),
  escrow_balance NUMERIC(14,2),   -- mortgage
  escrow_payment NUMERIC(14,2),   -- mortgage

  -- Late fees
  past_due_amount NUMERIC(14,2),
  late_fee NUMERIC(14,2),
  grace_date DATE,

  -- Finance charges (HELOC)
  finance_charge NUMERIC(14,2),
  daily_periodic_rate NUMERIC(10,8),

  -- YTD totals
  ytd_principal_paid NUMERIC(14,2),
  ytd_interest_paid NUMERIC(14,2),
  ytd_escrow_paid NUMERIC(14,2),
  ytd_fees_paid NUMERIC(14,2),

  -- Loan details
  maturity_date DATE,
  end_of_draw_date DATE,          -- HELOC
  vehicle_description TEXT,        -- auto-loan
  vin TEXT,                        -- auto-loan
  property_address TEXT,           -- mortgage/HELOC

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_loan_summary_doc ON loan_statement_summaries(document_id);
CREATE INDEX IF NOT EXISTS idx_loan_summary_type ON loan_statement_summaries(loan_type);
CREATE INDEX IF NOT EXISTS idx_loan_summary_date ON loan_statement_summaries(statement_date);

ALTER TABLE loan_statement_summaries ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'loan_statement_summaries' AND policyname = 'Authenticated read loan_summaries') THEN
    CREATE POLICY "Authenticated read loan_summaries" ON loan_statement_summaries FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'loan_statement_summaries' AND policyname = 'Service write loan_summaries') THEN
    CREATE POLICY "Service write loan_summaries" ON loan_statement_summaries FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- Loan Transactions (HELOC + Auto Loan + Mortgage)
-- ============================================================
CREATE TABLE IF NOT EXISTS loan_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  summary_id UUID REFERENCES loan_statement_summaries(id) ON DELETE CASCADE,
  document_id UUID REFERENCES document_index(id),

  institution TEXT NOT NULL,
  account_name TEXT NOT NULL,
  statement_date DATE NOT NULL,

  -- Transaction data
  transaction_date DATE NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  principal_amount NUMERIC(14,2),
  interest_amount NUMERIC(14,2),
  other_amount NUMERIC(14,2),
  transaction_type TEXT,         -- 'payment', 'disbursement', 'fee', 'interest', 'escrow'

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loan_txn_summary ON loan_transactions(summary_id);
CREATE INDEX IF NOT EXISTS idx_loan_txn_date ON loan_transactions(transaction_date);

ALTER TABLE loan_transactions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'loan_transactions' AND policyname = 'Authenticated read loan_txns') THEN
    CREATE POLICY "Authenticated read loan_txns" ON loan_transactions FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'loan_transactions' AND policyname = 'Service write loan_txns') THEN
    CREATE POLICY "Service write loan_txns" ON loan_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
