-- Prevent duplicate statements: same institution + account + period
CREATE UNIQUE INDEX idx_statement_inbox_unique_period
  ON statement_inbox (institution, account_number, period_start, period_end)
  WHERE institution IS NOT NULL
    AND account_number IS NOT NULL
    AND period_start IS NOT NULL
    AND period_end IS NOT NULL;
