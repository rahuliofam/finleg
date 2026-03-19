-- Add retry tracking columns to statement_inbox
ALTER TABLE statement_inbox ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;
ALTER TABLE statement_inbox ADD COLUMN IF NOT EXISTS last_error_context text;
