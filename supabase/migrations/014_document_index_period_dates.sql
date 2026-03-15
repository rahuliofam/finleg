-- Add period_start and period_end to document_index for statement date ranges
ALTER TABLE document_index ADD COLUMN IF NOT EXISTS period_start DATE;
ALTER TABLE document_index ADD COLUMN IF NOT EXISTS period_end DATE;

-- Backfill from cc_statement_summaries
UPDATE document_index di
SET period_start = s.period_start, period_end = s.period_end
FROM cc_statement_summaries s
WHERE di.id = s.document_id
  AND s.period_start IS NOT NULL;

-- Backfill from checking_statement_summaries
UPDATE document_index di
SET period_start = s.period_start, period_end = s.period_end
FROM checking_statement_summaries s
WHERE di.id = s.document_id
  AND s.period_start IS NOT NULL;

-- Backfill from investment_statement_summaries
UPDATE document_index di
SET period_start = s.period_start, period_end = s.period_end
FROM investment_statement_summaries s
WHERE di.id = s.document_id
  AND s.period_start IS NOT NULL;

-- Backfill from loan_statement_summaries
UPDATE document_index di
SET period_start = s.period_start, period_end = s.period_end
FROM loan_statement_summaries s
WHERE di.id = s.document_id
  AND s.period_start IS NOT NULL;
