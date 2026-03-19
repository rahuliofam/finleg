-- Separate verification model tracking from extraction model.
-- extraction_model = primary model that produced the stored data (e.g. gemini-2.5-flash)
-- verification_model = secondary model used to cross-check (e.g. claude-sonnet-4.6)
-- verification_status = agreed | conflicts | skipped | failed
-- verification_conflicts = JSONB array of field-level disagreements

ALTER TABLE tax_returns
  ADD COLUMN IF NOT EXISTS verification_model TEXT,
  ADD COLUMN IF NOT EXISTS verification_status TEXT,
  ADD COLUMN IF NOT EXISTS verification_conflicts JSONB;
