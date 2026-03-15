-- Drop existing empty app_users table (from template, no data)
DROP TABLE IF EXISTS app_users CASCADE;

-- App Users table: tracks users with roles beyond auth.users
CREATE TABLE app_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT,
  first_name TEXT,
  last_name TEXT,
  role TEXT NOT NULL DEFAULT 'public'
    CHECK (role IN ('oracle','admin','staff','resident','associate','demo','public','prospect','pending')),
  person_id UUID,
  invited_by UUID REFERENCES app_users(id),
  is_current_resident BOOLEAN DEFAULT false,
  is_archived BOOLEAN DEFAULT false,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_app_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_app_users_updated_at ON app_users;
CREATE TRIGGER update_app_users_updated_at
  BEFORE UPDATE ON app_users
  FOR EACH ROW EXECUTE FUNCTION update_app_users_updated_at();

-- RLS policies for app_users
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read app_users"
  ON app_users FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can update own app_user"
  ON app_users FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid());

CREATE POLICY "Allow insert for authenticated"
  ON app_users FOR INSERT TO authenticated
  WITH CHECK (true);

-- User Invitations table
DROP TABLE IF EXISTS user_invitations CASCADE;
CREATE TABLE user_invitations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'public'
    CHECK (role IN ('oracle','admin','staff','resident','associate','demo','public','prospect')),
  invited_by UUID REFERENCES app_users(id),
  invited_by_email TEXT,
  invited_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '7 days'),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','revoked','expired')),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read invitations"
  ON user_invitations FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert invitations"
  ON user_invitations FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update invitations"
  ON user_invitations FOR UPDATE TO authenticated USING (true);

-- Function to list app users with auth details
CREATE OR REPLACE FUNCTION list_app_users()
RETURNS TABLE (
  id UUID,
  auth_user_id UUID,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  role TEXT,
  provider TEXT,
  last_sign_in TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  is_archived BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = auth, public
AS $$
  SELECT
    au.id,
    au.auth_user_id,
    au.email,
    au.display_name,
    (u.raw_user_meta_data->>'avatar_url')::TEXT AS avatar_url,
    au.role,
    COALESCE(
      (SELECT p.provider FROM auth.identities p WHERE p.user_id = u.id LIMIT 1),
      'email'
    )::TEXT AS provider,
    u.last_sign_in_at AS last_sign_in,
    au.last_login_at,
    au.created_at,
    au.is_archived
  FROM public.app_users au
  LEFT JOIN auth.users u ON u.id = au.auth_user_id
  WHERE NOT au.is_archived
  ORDER BY au.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION list_app_users() TO authenticated;

-- Function to update a user's role
CREATE OR REPLACE FUNCTION update_user_role(p_user_id UUID, p_role TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.app_users SET role = p_role, updated_at = now()
  WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION update_user_role(UUID, TEXT) TO authenticated;

-- Seed: auto-create app_user for any existing auth users not yet in app_users
INSERT INTO app_users (auth_user_id, email, display_name, role)
SELECT
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
  'admin'
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM app_users au WHERE au.auth_user_id = u.id)
ON CONFLICT (auth_user_id) DO NOTHING;
