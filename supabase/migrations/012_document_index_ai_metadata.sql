-- Add AI metadata extraction columns to document_index
-- Supports Claude-powered document parsing for rich metadata

-- Human-readable description extracted by AI
ALTER TABLE document_index ADD COLUMN IF NOT EXISTS description TEXT;

-- Full AI extraction result as JSON (document_type, title, parties, tags, etc.)
ALTER TABLE document_index ADD COLUMN IF NOT EXISTS ai_metadata JSONB;

-- Index for filtering documents that still need AI extraction
CREATE INDEX IF NOT EXISTS idx_doc_ai_metadata_null ON document_index(ai_metadata) WHERE ai_metadata IS NULL;

-- Update FTS to include description
DROP INDEX IF EXISTS idx_doc_fts;
ALTER TABLE document_index DROP COLUMN IF EXISTS fts;

ALTER TABLE document_index ADD COLUMN fts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(filename, '') || ' ' ||
      coalesce(account_name, '') || ' ' ||
      coalesce(institution, '') || ' ' ||
      coalesce(original_path, '') || ' ' ||
      coalesce(description, '')
    )
  ) STORED;

CREATE INDEX idx_doc_fts ON document_index USING GIN(fts);
