-- Add R2 file key and source file name to all statement summary tables
-- Enables tracing extracted data back to the exact Cloudflare R2 source file

-- CC summaries
ALTER TABLE cc_statement_summaries
  ADD COLUMN IF NOT EXISTS r2_key TEXT,
  ADD COLUMN IF NOT EXISTS source_file_name TEXT;

-- Checking summaries
ALTER TABLE checking_statement_summaries
  ADD COLUMN IF NOT EXISTS r2_key TEXT,
  ADD COLUMN IF NOT EXISTS source_file_name TEXT;

-- Investment summaries
ALTER TABLE investment_statement_summaries
  ADD COLUMN IF NOT EXISTS r2_key TEXT,
  ADD COLUMN IF NOT EXISTS source_file_name TEXT;

-- Loan summaries
ALTER TABLE loan_statement_summaries
  ADD COLUMN IF NOT EXISTS r2_key TEXT,
  ADD COLUMN IF NOT EXISTS source_file_name TEXT;

-- Backfill from document_index for any already-ingested rows
UPDATE cc_statement_summaries s
  SET r2_key = d.r2_key, source_file_name = d.filename
  FROM document_index d
  WHERE s.document_id = d.id AND s.r2_key IS NULL;

UPDATE checking_statement_summaries s
  SET r2_key = d.r2_key, source_file_name = d.filename
  FROM document_index d
  WHERE s.document_id = d.id AND s.r2_key IS NULL;

UPDATE investment_statement_summaries s
  SET r2_key = d.r2_key, source_file_name = d.filename
  FROM document_index d
  WHERE s.document_id = d.id AND s.r2_key IS NULL;

UPDATE loan_statement_summaries s
  SET r2_key = d.r2_key, source_file_name = d.filename
  FROM document_index d
  WHERE s.document_id = d.id AND s.r2_key IS NULL;
