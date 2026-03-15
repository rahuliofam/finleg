-- Function to list auth users (security definer to access auth schema)
CREATE OR REPLACE FUNCTION list_auth_users()
RETURNS TABLE (
  id UUID,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  provider TEXT,
  last_sign_in TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = auth, public
AS $$
  SELECT
    u.id,
    u.email::TEXT,
    COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name')::TEXT AS display_name,
    (u.raw_user_meta_data->>'avatar_url')::TEXT AS avatar_url,
    COALESCE(
      (SELECT p.provider FROM auth.identities p WHERE p.user_id = u.id LIMIT 1),
      'email'
    )::TEXT AS provider,
    u.last_sign_in_at AS last_sign_in,
    u.created_at
  FROM auth.users u
  ORDER BY u.created_at DESC;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION list_auth_users() TO authenticated;

-- Releases table to track deployments
CREATE TABLE IF NOT EXISTS releases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  version TEXT NOT NULL,
  release_number INTEGER NOT NULL,
  sha TEXT NOT NULL,
  full_sha TEXT,
  actor TEXT,
  source TEXT,
  pushed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  commits JSONB DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(release_number)
);

-- Enable RLS
ALTER TABLE releases ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read releases
CREATE POLICY "Authenticated users can read releases"
  ON releases FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can insert releases (for CI/CD)
CREATE POLICY "Authenticated users can insert releases"
  ON releases FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Also allow anon to insert (for CI webhook)
CREATE POLICY "Anon can insert releases"
  ON releases FOR INSERT
  TO anon
  WITH CHECK (true);

-- Allow anon to read releases
CREATE POLICY "Anon can read releases"
  ON releases FOR SELECT
  TO anon
  USING (true);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_releases_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_releases_updated_at
  BEFORE UPDATE ON releases
  FOR EACH ROW
  EXECUTE FUNCTION update_releases_updated_at();
