-- Document sharing: shareable links for authenticated users
-- Shares require authentication to view (no public anonymous access)

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS document_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES document_index(id) ON DELETE CASCADE,
  share_token TEXT NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(16), 'hex'),
  created_by UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,                       -- NULL = never expires
  note TEXT,                                     -- optional message when sharing
  is_revoked BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_document_shares_token ON document_shares(share_token);
CREATE INDEX idx_document_shares_document ON document_shares(document_id);

-- Track who a share was sent to
CREATE TABLE IF NOT EXISTS document_share_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id UUID NOT NULL REFERENCES document_shares(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  viewed_at TIMESTAMPTZ,                         -- set on first view
  UNIQUE(share_id, recipient_user_id)
);

-- RLS
ALTER TABLE document_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_share_recipients ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read shares (needed to resolve tokens)
CREATE POLICY "Authenticated read document_shares"
  ON document_shares FOR SELECT TO authenticated USING (true);

-- Only the creator or admins can insert/update shares
CREATE POLICY "Users create own shares"
  ON document_shares FOR INSERT TO authenticated
  WITH CHECK (created_by IN (
    SELECT id FROM app_users WHERE auth_user_id = auth.uid()
  ));

CREATE POLICY "Users update own shares"
  ON document_shares FOR UPDATE TO authenticated
  USING (created_by IN (
    SELECT id FROM app_users WHERE auth_user_id = auth.uid()
  ) OR is_admin());

-- Recipients: authenticated read, insert by share creator
CREATE POLICY "Authenticated read share_recipients"
  ON document_share_recipients FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated insert share_recipients"
  ON document_share_recipients FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated update share_recipients"
  ON document_share_recipients FOR UPDATE TO authenticated
  USING (true);
