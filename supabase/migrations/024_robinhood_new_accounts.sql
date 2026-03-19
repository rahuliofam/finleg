-- Add display names for new Robinhood accounts (Gold Card 6868, Checking 2074)
INSERT INTO account_display_names (institution, account_number, account_name, display_name) VALUES
  ('robinhood', '6868', 'Robinhood Gold Card', 'RobinGold Visa #2'),
  ('robinhood', '2074', 'Robinhood Checking', 'Robinhood Checking')
ON CONFLICT (institution, account_number, account_name) DO NOTHING;
