-- Contacts directory: professionals, vendors, service providers
CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  title TEXT,                          -- e.g. "Legal Services Manager"
  organization TEXT,                   -- e.g. "CRN Law"
  category TEXT NOT NULL,              -- e.g. "Real Estate Attorney Land Purchase Lawyer"
  email TEXT,
  phone TEXT,
  fax TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  website TEXT,
  notes TEXT,                          -- free-form notes / context
  source TEXT,                         -- where we found them, e.g. "Email Jan 2024"
  tags TEXT[] DEFAULT '{}',            -- searchable tags
  is_archived BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_contacts_category ON contacts(category);
CREATE INDEX idx_contacts_name ON contacts(name);
CREATE INDEX idx_contacts_tags ON contacts USING GIN(tags);

-- RLS
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages contacts"
  ON contacts FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can read contacts"
  ON contacts FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins can manage contacts"
  ON contacts FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE auth_user_id = auth.uid()
      AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE auth_user_id = auth.uid()
      AND role = 'admin'
    )
  );

-- Seed: Mark Stevens (CRN Law) — Cedar Creek property purchase option
INSERT INTO contacts (name, title, organization, category, email, phone, fax, address_line1, city, state, zip, website, notes, source, tags)
VALUES (
  'Mark Stevens',
  'Legal Services Manager',
  'CRN Law',
  'Real Estate Attorney Land Purchase Lawyer',
  'mstevens@crnlaw.com',
  '210-981-2212',
  '512-687-0728',
  '2822 N. Loop 1604 West, Suite 116',
  'San Antonio',
  'TX',
  '78248',
  'crnlaw.com',
  'Discussed first right of refusal for Cedar Creek property purchase. Advised nominal payment to make agreement binding rather than large down payment. Contact via Julia at CRN.',
  'Email from Mark Stevens, Jan 12 2024',
  ARRAY['cedar-creek', 'land-purchase', 'first-right-of-refusal', 'texas', 'real-estate']
);
