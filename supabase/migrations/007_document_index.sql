-- Document index for R2-stored financial files
-- Enables full-text search and metadata filtering in the File Vault

CREATE TABLE IF NOT EXISTS document_index (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- R2 location
  bucket TEXT NOT NULL,           -- 'financial-statements', 'bookkeeping-docs', 'legal-docs'
  r2_key TEXT NOT NULL UNIQUE,    -- full R2 object key

  -- File info
  filename TEXT NOT NULL,
  file_type TEXT NOT NULL,        -- pdf, xlsx, csv, docx, png, jpg, etc.
  file_size BIGINT,
  content_type TEXT,              -- MIME type

  -- Metadata for filtering
  category TEXT NOT NULL,         -- statement, tax, insurance, property-expense, credit-report, reference, backup, analysis
  account_type TEXT NOT NULL,     -- credit-card, checking, payment, brokerage, ira, trust, crypto, mortgage, heloc, credit-line, auto-loan, sba-loan, tax, insurance, property, credit-report, summary, closed, accounting-software, analysis
  institution TEXT,               -- amex, chase, charles-schwab, us-bank, robinhood, coinbase, pnc, sba, etc.
  account_name TEXT,              -- human-readable account name
  account_number TEXT,            -- last 4 or full account number
  account_holder TEXT,            -- Rahul, Subhash, Trust, Family, Tesloop, various

  -- Date metadata
  year INTEGER,
  month INTEGER,
  statement_date DATE,

  -- Additional flags
  is_closed BOOLEAN DEFAULT FALSE,
  property TEXT,                  -- alpaca-playhouse, wa-sharingwood
  convertible BOOLEAN DEFAULT FALSE,  -- flagged for future Supabase table conversion
  original_path TEXT,             -- original local filesystem path

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for common filter patterns
CREATE INDEX idx_doc_bucket ON document_index(bucket);
CREATE INDEX idx_doc_category ON document_index(category);
CREATE INDEX idx_doc_account_type ON document_index(account_type);
CREATE INDEX idx_doc_institution ON document_index(institution);
CREATE INDEX idx_doc_account_holder ON document_index(account_holder);
CREATE INDEX idx_doc_year ON document_index(year);
CREATE INDEX idx_doc_file_type ON document_index(file_type);
CREATE INDEX idx_doc_is_closed ON document_index(is_closed);

-- Full-text search index on filename, account_name, original_path
ALTER TABLE document_index ADD COLUMN fts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(filename, '') || ' ' ||
      coalesce(account_name, '') || ' ' ||
      coalesce(institution, '') || ' ' ||
      coalesce(original_path, '')
    )
  ) STORED;

CREATE INDEX idx_doc_fts ON document_index USING GIN(fts);

-- RLS
ALTER TABLE document_index ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read
CREATE POLICY "Authenticated users can read documents"
  ON document_index FOR SELECT
  TO authenticated
  USING (true);

-- Allow service role to insert/update/delete
CREATE POLICY "Service role can manage documents"
  ON document_index FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
