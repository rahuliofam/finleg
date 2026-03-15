-- Account display names: editable friendly names for financial accounts
CREATE TABLE IF NOT EXISTS account_display_names (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  institution text NOT NULL,
  account_number text NOT NULL DEFAULT '',
  account_name text NOT NULL DEFAULT '',
  display_name text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(institution, account_number, account_name)
);

ALTER TABLE account_display_names ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read display names"
  ON account_display_names FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert display names"
  ON account_display_names FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update display names"
  ON account_display_names FOR UPDATE TO authenticated USING (true);

-- Seed with friendly names from Schwab/Portsie portfolio view
INSERT INTO account_display_names (institution, account_number, account_name, display_name) VALUES
  -- Credit Cards
  ('amex', '24006', 'Amex Blue Preferred', 'Amex Blue Preferred'),
  ('amex', '11003', 'Amex Blue Business', 'Amex Blue Business'),
  ('apple', '2202', 'Apple Card', 'Apple Card'),
  ('chase', '4206', 'Chase Amazon CC', 'Amazon Prime'),
  ('chase', '7191', 'Chase Visa CC', 'Chase CC'),
  ('bank-of-america', '6420', 'Bank of America CC', 'BofA CC'),
  ('robinhood', '3892', 'Robinhood Gold Card', 'RobinGold Visa'),
  -- Bank Accounts
  ('charles-schwab', '3711', 'CS Checking', 'Rahul SchwabChecking'),
  ('us-bank', '7444', 'US Bank Checking', 'USB Primary'),
  ('cash-app', '', 'Cash App', 'Cash App'),
  ('venmo', '', 'Venmo', 'Venmo'),
  ('paypal', '', 'PayPal', 'PayPal'),
  -- Brokerage
  ('charles-schwab', '0566', 'CS Brokerage', 'Rahul Brokerage'),
  ('charles-schwab', '2028', 'CS Brokerage', 'SubTrust Brokerage'),
  ('charles-schwab', '2192', 'CS Trading', 'Rahul Trading'),
  -- IRA / Trust
  ('charles-schwab', '3902', 'CS IRA', 'RS Trad IRA'),
  ('charles-schwab', '0044', 'CS Trust', 'SubTrust Checking'),
  ('robinhood', '8249/2310', 'Robinhood Roth IRA & Traditional IRA', 'RobinRoth & RobinTradIRA'),
  ('robinhood', '', 'Robinhood Consolidated IRA', 'Robinhood Consolidated IRA'),
  ('coinbase', '', 'Coinbase', 'Coinbase'),
  -- Loans
  ('pnc', '', 'PNC Mortgage', 'Playhouse Mortgage'),
  ('us-bank', '9078', 'US Bank Equity Line', 'US Bank Equity'),
  ('us-bank', '3784', 'US Bank Overdraft Credit Line', 'US Bank LOC'),
  ('various', '', 'Auto Loans', 'Chase MY Sloop Loan'),
  ('sba', '4469264009', 'SBA Physical Business Disaster Loan', 'SBA Physical Business'),
  ('sba', '9663307809', 'SBA COVID-19 Economic Injury Loan', 'SBA COVID Injury')
ON CONFLICT (institution, account_number, account_name) DO NOTHING;
