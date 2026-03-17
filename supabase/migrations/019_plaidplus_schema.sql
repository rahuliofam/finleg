-- ============================================================
-- PlaidPlus Schema — Universal Financial Data Model
-- Plaid-derived + Schwab operational tables, multi-institution
-- Covers: brokerage, checking, savings, credit card, loan, 401k, IRA
-- Deprecates: 019_schwab_integration.sql (never run)
-- ============================================================

-- ============================================================
-- 1. INSTITUTIONS — banks, brokerages, credit unions
-- ============================================================
CREATE TABLE IF NOT EXISTS institutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,            -- "Charles Schwab", "Chase", "Fidelity"
  institution_type TEXT NOT NULL         -- brokerage, bank, credit_union, insurance
    CHECK (institution_type IN ('brokerage','bank','credit_union','insurance','other')),
  plaid_institution_id TEXT,            -- if connected via Plaid
  website TEXT,
  logo_url TEXT,
  metadata JSONB DEFAULT '{}',          -- routing numbers, BIC, etc.
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE institutions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'institutions' AND policyname = 'Auth read institutions') THEN
    CREATE POLICY "Auth read institutions" ON institutions FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'institutions' AND policyname = 'Service manage institutions') THEN
    CREATE POLICY "Service manage institutions" ON institutions FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- 2. ACCOUNTS — every financial account across all institutions
-- ============================================================
CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,

  -- Identity
  account_number_masked TEXT,           -- "****4521"
  account_number_encrypted TEXT,        -- AES-256-GCM full number
  display_name TEXT,                    -- user-facing label
  official_name TEXT,                   -- institution's name for it

  -- Classification
  account_type TEXT NOT NULL
    CHECK (account_type IN (
      'brokerage','ira','roth_ira','401k','403b','529',
      'checking','savings','money_market','cd',
      'credit_card',
      'mortgage','heloc','auto_loan','student_loan','personal_loan',
      'hsa','trust','annuity','other'
    )),
  account_subtype TEXT,                 -- institution-specific refinement

  -- Currency
  currency_code TEXT DEFAULT 'USD',

  -- Current balances (updated each sync)
  balance_current NUMERIC(14,2),        -- current/statement balance
  balance_available NUMERIC(14,2),      -- available to spend/withdraw
  balance_limit NUMERIC(14,2),          -- credit limit or credit line

  -- Investment-specific (null for non-investment accounts)
  total_value NUMERIC(14,2),            -- total portfolio value
  cash_balance NUMERIC(14,2),           -- uninvested cash
  buying_power NUMERIC(14,2),
  margin_balance NUMERIC(14,2),

  -- Loan-specific (null for non-loan accounts)
  principal_balance NUMERIC(14,2),
  interest_rate NUMERIC(8,5),           -- e.g. 0.06750 = 6.75%
  maturity_date DATE,
  origination_date DATE,

  -- Holder
  account_holder TEXT,                  -- name on account
  is_joint BOOLEAN DEFAULT false,

  -- Status
  is_active BOOLEAN DEFAULT true,
  is_closed BOOLEAN DEFAULT false,
  closed_at TIMESTAMPTZ,

  -- Connection
  connection_type TEXT DEFAULT 'manual'
    CHECK (connection_type IN ('api','plaid','manual','pdf')),
  external_account_id TEXT,             -- brokerage's hash/ID for dedup

  -- Escape hatch
  raw_json JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',

  -- Sync tracking
  first_synced_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,

  -- Link to document_index for PDF-sourced accounts
  document_id UUID REFERENCES document_index(id),

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(institution_id, external_account_id)
);

CREATE INDEX IF NOT EXISTS idx_accounts_institution ON accounts(institution_id);
CREATE INDEX IF NOT EXISTS idx_accounts_type ON accounts(account_type);
CREATE INDEX IF NOT EXISTS idx_accounts_active ON accounts(is_active) WHERE is_active = true;

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'accounts' AND policyname = 'Auth read accounts') THEN
    CREATE POLICY "Auth read accounts" ON accounts FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'accounts' AND policyname = 'Service manage accounts') THEN
    CREATE POLICY "Service manage accounts" ON accounts FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- 3. SECURITIES — normalized instrument reference table
-- ============================================================
CREATE TABLE IF NOT EXISTS securities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identifiers (at least one required)
  ticker_symbol TEXT,
  cusip TEXT,
  isin TEXT,
  sedol TEXT,

  -- Description
  name TEXT NOT NULL,                   -- "Apple Inc.", "Vanguard S&P 500 ETF"
  security_type TEXT NOT NULL
    CHECK (security_type IN (
      'equity','etf','mutual_fund','bond','option','futures',
      'fixed_income','money_market','cash','crypto','warrant','other'
    )),
  asset_class TEXT,                     -- large_cap, small_cap, international, fixed_income, etc.
  sector TEXT,                          -- technology, healthcare, etc.
  exchange TEXT,                        -- NYSE, NASDAQ, etc.

  -- Options/warrants (null for non-derivative securities)
  underlying_ticker TEXT,               -- e.g. "TSLA" for TSLA options
  expiration_date DATE,                 -- option/warrant expiration
  strike_price NUMERIC(14,4),           -- option/warrant strike
  option_type TEXT                      -- call, put (null for warrants/equities)
    CHECK (option_type IN ('call','put') OR option_type IS NULL),

  -- Reference data
  currency_code TEXT DEFAULT 'USD',
  close_price NUMERIC(14,4),            -- latest known price
  close_price_as_of DATE,

  metadata JSONB DEFAULT '{}',          -- dividend info, expense ratio, etc.
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_securities_ticker ON securities(ticker_symbol) WHERE ticker_symbol IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_securities_cusip ON securities(cusip) WHERE cusip IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_securities_isin ON securities(isin) WHERE isin IS NOT NULL;

ALTER TABLE securities ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'securities' AND policyname = 'Auth read securities') THEN
    CREATE POLICY "Auth read securities" ON securities FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'securities' AND policyname = 'Service manage securities') THEN
    CREATE POLICY "Service manage securities" ON securities FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- 4. HOLDINGS — current positions (mutable, updated each sync)
-- ============================================================
CREATE TABLE IF NOT EXISTS holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  security_id UUID NOT NULL REFERENCES securities(id),

  -- Position
  quantity NUMERIC(18,8) NOT NULL,
  cost_basis NUMERIC(14,2),
  market_value NUMERIC(14,2),
  price NUMERIC(14,4),                  -- current/last price
  price_as_of TIMESTAMPTZ,

  -- Calculated
  unrealized_gain_loss NUMERIC(14,2),
  unrealized_gain_loss_pct NUMERIC(8,4),
  pct_of_account NUMERIC(8,4),         -- allocation %

  -- Income
  estimated_yield NUMERIC(8,4),
  estimated_annual_income NUMERIC(14,2),

  -- Lending
  is_loaned BOOLEAN DEFAULT false,      -- Robinhood stock lending program

  -- Escape hatch
  raw_json JSONB DEFAULT '{}',
  last_synced_at TIMESTAMPTZ DEFAULT now(),

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(account_id, security_id)
);

CREATE INDEX IF NOT EXISTS idx_holdings_account ON holdings(account_id);
CREATE INDEX IF NOT EXISTS idx_holdings_security ON holdings(security_id);

ALTER TABLE holdings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'holdings' AND policyname = 'Auth read holdings') THEN
    CREATE POLICY "Auth read holdings" ON holdings FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'holdings' AND policyname = 'Service manage holdings') THEN
    CREATE POLICY "Service manage holdings" ON holdings FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- 5. TRANSACTIONS — unified across ALL account types
--    type+subtype pattern avoids schema changes for new data
-- ============================================================
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  security_id UUID REFERENCES securities(id),  -- null for non-investment txns

  -- Dedup
  external_id TEXT,                     -- brokerage/bank transaction ID
  UNIQUE(account_id, external_id),

  -- Classification (Plaid-inspired taxonomy)
  transaction_type TEXT NOT NULL
    CHECK (transaction_type IN (
      -- Investment
      'buy','sell','short','cover',
      'dividend','interest','capital_gain',
      'transfer','deposit','withdrawal',
      'fee','tax','margin_interest',
      'reinvestment','stock_split','spin_off','merger',
      'corporate_action','liquidation',
      -- Banking
      'debit','credit','payment','refund',
      'atm','check','wire','ach',
      -- Loan
      'principal_payment','interest_payment','escrow_payment',
      'late_fee','prepayment',
      -- Universal
      'adjustment','other'
    )),
  transaction_subtype TEXT,             -- finer grain: "qualified_dividend", "wash_sale", etc.

  -- Dates
  transaction_date DATE NOT NULL,
  settlement_date DATE,
  posted_at TIMESTAMPTZ,

  -- Amounts
  amount NUMERIC(14,2) NOT NULL,        -- positive=inflow, negative=outflow
  quantity NUMERIC(18,8),               -- shares/units (investment only)
  price NUMERIC(14,4),                  -- per-unit price (investment only)
  fees NUMERIC(12,2) DEFAULT 0,
  net_amount NUMERIC(14,2),             -- amount after fees

  -- Description
  description TEXT,
  memo TEXT,
  category TEXT,                        -- user/AI assigned category
  vendor_name TEXT,                     -- payee for banking txns
  check_number TEXT,
  reference_number TEXT,

  -- Foreign currency
  foreign_amount NUMERIC(14,2),
  foreign_currency TEXT,
  exchange_rate NUMERIC(14,6),

  -- Running balance (for statement reconciliation)
  running_balance NUMERIC(14,2),

  -- Source tracking
  source TEXT DEFAULT 'api'
    CHECK (source IN ('api','plaid','pdf','manual','csv')),
  document_id UUID REFERENCES document_index(id),  -- link to PDF source

  -- Escape hatch
  raw_json JSONB DEFAULT '{}',
  synced_at TIMESTAMPTZ DEFAULT now(),

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_transactions_security ON transactions(security_id) WHERE security_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_source ON transactions(source);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'transactions' AND policyname = 'Auth read transactions') THEN
    CREATE POLICY "Auth read transactions" ON transactions FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'transactions' AND policyname = 'Service manage transactions') THEN
    CREATE POLICY "Service manage transactions" ON transactions FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- 6. TAX LOTS — cost basis tracking per acquisition lot
-- ============================================================
CREATE TABLE IF NOT EXISTS tax_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  security_id UUID NOT NULL REFERENCES securities(id),

  -- Acquisition
  acquired_date DATE NOT NULL,
  quantity NUMERIC(18,8) NOT NULL,
  cost_basis NUMERIC(14,2) NOT NULL,    -- total cost (qty * price + fees)
  cost_per_share NUMERIC(14,6),

  -- Disposition (filled when sold)
  disposed_date DATE,
  disposed_quantity NUMERIC(18,8),
  proceeds NUMERIC(14,2),
  gain_loss NUMERIC(14,2),
  term TEXT                             -- short, long
    CHECK (term IN ('short','long')),
  is_closed BOOLEAN DEFAULT false,

  -- Wash sale tracking
  wash_sale_adjustment NUMERIC(14,2) DEFAULT 0,
  wash_sale_disallowed NUMERIC(14,2) DEFAULT 0,

  -- Tax reporting
  form_8949_code TEXT                   -- A/B/C/D/E/F per IRS rules
    CHECK (form_8949_code IN ('A','B','C','D','E','F') OR form_8949_code IS NULL),

  -- Link to buy/sell transactions
  open_transaction_id UUID REFERENCES transactions(id),
  close_transaction_id UUID REFERENCES transactions(id),

  -- Escape hatch
  raw_json JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tax_lots_account ON tax_lots(account_id);
CREATE INDEX IF NOT EXISTS idx_tax_lots_security ON tax_lots(security_id);
CREATE INDEX IF NOT EXISTS idx_tax_lots_open ON tax_lots(is_closed) WHERE is_closed = false;

ALTER TABLE tax_lots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tax_lots' AND policyname = 'Auth read tax_lots') THEN
    CREATE POLICY "Auth read tax_lots" ON tax_lots FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tax_lots' AND policyname = 'Service manage tax_lots') THEN
    CREATE POLICY "Service manage tax_lots" ON tax_lots FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- 7. ACCOUNT BALANCES — historical balance snapshots
-- ============================================================
CREATE TABLE IF NOT EXISTS account_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,

  -- Universal balances
  balance_current NUMERIC(14,2),
  balance_available NUMERIC(14,2),

  -- Investment-specific
  total_value NUMERIC(14,2),
  cash_balance NUMERIC(14,2),
  sweep_balance NUMERIC(14,2),          -- Robinhood deposit sweep / cash sweep
  long_market_value NUMERIC(14,2),
  short_market_value NUMERIC(14,2),
  buying_power NUMERIC(14,2),
  margin_balance NUMERIC(14,2),

  -- Credit-specific
  credit_limit NUMERIC(14,2),
  minimum_payment NUMERIC(14,2),
  payment_due_date DATE,

  -- Loan-specific
  principal_balance NUMERIC(14,2),
  interest_rate NUMERIC(8,5),
  escrow_balance NUMERIC(14,2),

  -- Escape hatch
  raw_json JSONB DEFAULT '{}',
  synced_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(account_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_account_balances_date ON account_balances(snapshot_date);

ALTER TABLE account_balances ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'account_balances' AND policyname = 'Auth read account_balances') THEN
    CREATE POLICY "Auth read account_balances" ON account_balances FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'account_balances' AND policyname = 'Service manage account_balances') THEN
    CREATE POLICY "Service manage account_balances" ON account_balances FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- 8. OAUTH TOKENS — per-institution API credentials
-- ============================================================
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,

  -- OAuth2
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_type TEXT DEFAULT 'Bearer',
  scope TEXT,
  access_token_expires_at TIMESTAMPTZ NOT NULL,
  refresh_token_expires_at TIMESTAMPTZ,

  -- Connection metadata
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','expired','revoked','error')),
  realm_id TEXT,                        -- QB company ID, Plaid item ID, etc.
  external_client_id TEXT,              -- app key / client ID (non-secret)

  connected_at TIMESTAMPTZ DEFAULT now(),
  last_refreshed_at TIMESTAMPTZ,
  error_message TEXT,

  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(institution_id)
);

ALTER TABLE oauth_tokens ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'oauth_tokens' AND policyname = 'Service manage oauth_tokens') THEN
    CREATE POLICY "Service manage oauth_tokens" ON oauth_tokens FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- 9. ORDERS — active + historical (investment accounts)
-- ============================================================
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  security_id UUID REFERENCES securities(id),

  external_order_id TEXT NOT NULL,
  order_type TEXT,                      -- MARKET, LIMIT, STOP, STOP_LIMIT, TRAILING_STOP
  instruction TEXT,                     -- BUY, SELL, BUY_TO_COVER, SELL_SHORT
  duration TEXT,                        -- DAY, GTC, FOK, IOC
  status TEXT,                          -- WORKING, FILLED, CANCELED, REJECTED, EXPIRED

  quantity NUMERIC(18,8),
  filled_quantity NUMERIC(18,8),
  price NUMERIC(14,4),                  -- limit/requested price
  filled_price NUMERIC(14,4),           -- actual execution price
  stop_price NUMERIC(14,4),

  entered_at TIMESTAMPTZ,
  filled_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,

  raw_json JSONB DEFAULT '{}',
  synced_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(account_id, external_order_id)
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_account ON orders(account_id);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'orders' AND policyname = 'Auth read orders') THEN
    CREATE POLICY "Auth read orders" ON orders FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'orders' AND policyname = 'Service manage orders') THEN
    CREATE POLICY "Service manage orders" ON orders FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- 10. QUOTES CACHE — market data with short TTL
-- ============================================================
CREATE TABLE IF NOT EXISTS quotes_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  security_id UUID NOT NULL REFERENCES securities(id) ON DELETE CASCADE,

  last_price NUMERIC(14,4),
  open_price NUMERIC(14,4),
  high_price NUMERIC(14,4),
  low_price NUMERIC(14,4),
  close_price NUMERIC(14,4),
  bid_price NUMERIC(14,4),
  ask_price NUMERIC(14,4),
  volume BIGINT,

  net_change NUMERIC(14,4),
  net_change_pct NUMERIC(8,4),
  fifty_two_week_high NUMERIC(14,4),
  fifty_two_week_low NUMERIC(14,4),

  pe_ratio NUMERIC(10,4),
  dividend_yield NUMERIC(8,4),
  market_cap NUMERIC(20,2),

  raw_json JSONB DEFAULT '{}',
  fetched_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(security_id)
);

ALTER TABLE quotes_cache ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'quotes_cache' AND policyname = 'Auth read quotes_cache') THEN
    CREATE POLICY "Auth read quotes_cache" ON quotes_cache FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'quotes_cache' AND policyname = 'Service manage quotes_cache') THEN
    CREATE POLICY "Service manage quotes_cache" ON quotes_cache FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- 11. SYNC RUNS — execution log (brokerage-agnostic)
-- ============================================================
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

-- ============================================================
-- Updated_at triggers for all mutable tables
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'institutions','accounts','securities','holdings',
    'transactions','tax_lots','oauth_tokens'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS set_updated_at ON %I; CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();',
      tbl, tbl
    );
  END LOOP;
END $$;

-- ============================================================
-- Seed page_display_config for unified financial views
-- ============================================================
INSERT INTO page_display_config (section, tab_key, tab_label, is_visible, sort_order)
VALUES
  ('investments', 'portfolio', 'Portfolio', true, 0),
  ('investments', 'transactions', 'Transactions', true, 10),
  ('investments', 'accounts', 'Accounts', true, 20),
  ('investments', 'tax-lots', 'Tax Lots', true, 30),
  ('investments', 'sync', 'Sync', true, 40)
ON CONFLICT (section, tab_key) DO NOTHING;
