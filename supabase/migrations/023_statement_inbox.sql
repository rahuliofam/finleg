-- Statement Inbox: tracks emailed statements from classification through parsing
-- Emails to agent@finleg.net with statement PDFs are classified by Gemini Flash,
-- stored here, then picked up by Hostinger for Claude CLI parsing + R2 upload.

CREATE TABLE statement_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id TEXT UNIQUE NOT NULL,
  from_address TEXT,
  subject TEXT,
  received_at TIMESTAMPTZ,

  -- Attachment info
  attachment_filename TEXT NOT NULL,
  attachment_url TEXT NOT NULL,
  attachment_size BIGINT,

  -- Gemini classification results
  doc_type TEXT NOT NULL DEFAULT 'unknown',
  institution TEXT,
  account_type TEXT,
  account_name TEXT,
  account_number TEXT,
  account_holder TEXT,
  statement_date DATE,
  period_start DATE,
  period_end DATE,
  classification_confidence NUMERIC,
  classification_raw JSONB,

  -- Processing state
  status TEXT NOT NULL DEFAULT 'pending',
  r2_key TEXT,
  document_id UUID REFERENCES document_index(id),
  error_message TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_statement_inbox_status ON statement_inbox(status);
CREATE INDEX idx_statement_inbox_institution ON statement_inbox(institution);
CREATE INDEX idx_statement_inbox_created ON statement_inbox(created_at DESC);

-- RLS
ALTER TABLE statement_inbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON statement_inbox FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Storage bucket for incoming statement PDFs
INSERT INTO storage.buckets (id, name, public)
VALUES ('statements', 'statements', true)
ON CONFLICT (id) DO NOTHING;
