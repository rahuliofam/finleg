-- Add SHA-256 content hash for universal duplicate file detection.
-- Hash is computed on raw file bytes before any classification or extraction.

-- statement_inbox: dedup inbound emails
ALTER TABLE statement_inbox
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_statement_inbox_content_hash
  ON statement_inbox(content_hash)
  WHERE content_hash IS NOT NULL;

-- document_index: dedup across the full file vault
ALTER TABLE document_index
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_document_index_content_hash
  ON document_index(content_hash)
  WHERE content_hash IS NOT NULL;
