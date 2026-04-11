-- Person alias resolution: maps alternate names to canonical account_holder names
-- Used by the email agent to resolve "Phoebe Sonnad" → look up documents under the canonical name

CREATE TABLE IF NOT EXISTS person_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name TEXT NOT NULL,      -- the account_holder value used in document_index
  alias TEXT NOT NULL,               -- alternate name (lowercased for matching)
  notes TEXT,                        -- why this alias exists
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(alias)
);

CREATE INDEX idx_person_aliases_alias ON person_aliases(alias);
CREATE INDEX idx_person_aliases_canonical ON person_aliases(canonical_name);

-- RLS
ALTER TABLE person_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages person_aliases"
  ON person_aliases FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can read person_aliases"
  ON person_aliases FOR SELECT TO authenticated
  USING (true);

-- Seed aliases: canonical_name must match document_index.account_holder values
INSERT INTO person_aliases (canonical_name, alias, notes) VALUES
  ('Rahul', 'rahul sonnad', 'Full name'),
  ('Rahul', 'rahul', 'First name'),
  ('Subhash', 'subhash sonnad', 'Full name'),
  ('Subhash', 'subhash', 'First name'),
  ('Trust', 'trust', 'Shorthand'),
  ('Trust', 'subhash trust', 'Trust shorthand'),
  ('Trust', 'revocable trust', 'Trust shorthand'),
  ('Trust', 'revocable trust of subhash sonnad', 'Full trust name'),
  ('Hannah', 'hannah phoebe sonnad', 'Full legal name'),
  ('Hannah', 'hannah sonnad', 'First + last'),
  ('Hannah', 'phoebe sonnad', 'Goes by Phoebe'),
  ('Hannah', 'phoebe', 'Middle name only'),
  ('Hannah', 'hannah', 'First name'),
  ('Family', 'family', 'Family accounts'),
  ('Family', 'sonnad family', 'Family accounts'),
  ('Emina', 'emina', 'First name'),
  ('Emina', 'emina sonnad', 'Full name'),
  ('Tesloop', 'tesloop', 'Business entity'),
  ('Haydn', 'haydn', 'First name'),
  ('Haydn', 'haydn sonnad', 'Full name'),
  ('Kathy', 'kathy', 'First name'),
  -- Email address aliases (for sender-based identity resolution)
  ('Rahul', 'rahulioson@gmail.com', 'Email'),
  ('Rahul', 'rahchak@gmail.com', 'Email'),
  ('Hannah', 'sonnad.phoebe@gmail.com', 'Email'),
  ('Emina', 'esonnad@gmail.com', 'Email'),
  ('Haydn', 'hrsonnad@gmail.com', 'Email')
ON CONFLICT (alias) DO NOTHING;
