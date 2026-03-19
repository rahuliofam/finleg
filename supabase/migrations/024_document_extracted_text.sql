-- Add extracted_text column to document_index for full-text content storage
-- This stores the raw text extracted from PDFs, DOCX, and markdown files

ALTER TABLE document_index ADD COLUMN IF NOT EXISTS extracted_text TEXT;

-- Update the full-text search vector to include extracted_text
DROP TRIGGER IF EXISTS tsvector_update_document_index ON document_index;

CREATE OR REPLACE FUNCTION document_index_fts_update() RETURNS trigger AS $$
BEGIN
  NEW.fts :=
    setweight(to_tsvector('english', COALESCE(NEW.filename, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.account_name, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.institution, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.original_path, '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(LEFT(NEW.extracted_text, 10000), '')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tsvector_update_document_index
  BEFORE INSERT OR UPDATE ON document_index
  FOR EACH ROW EXECUTE FUNCTION document_index_fts_update();

-- Backfill FTS for existing rows that have descriptions
UPDATE document_index SET updated_at = NOW() WHERE description IS NOT NULL;
