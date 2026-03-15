-- Security hardening migration
-- Fixes: privilege escalation, data leaks, overly-permissive RLS

-- ============================================================
-- 1. Helper: check if the calling user is an admin
-- ============================================================
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_users
    WHERE auth_user_id = auth.uid()
      AND role = 'admin'
  );
$$;

-- ============================================================
-- 2. Fix update_user_role — restrict to admin callers only
-- ============================================================
CREATE OR REPLACE FUNCTION update_user_role(p_user_id UUID, p_role TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only admins can change roles
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin role required';
  END IF;

  UPDATE app_users SET role = p_role, updated_at = now()
  WHERE id = p_user_id;
END;
$$;

-- ============================================================
-- 3. Fix list_auth_users — restrict to admin callers only
-- ============================================================
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
BEGIN
  -- Only admins can list auth users
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin role required';
  END IF;

  RETURN QUERY
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
END;
$$;

-- ============================================================
-- 4. Fix list_app_users — restrict to admin callers only
-- ============================================================
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
BEGIN
  -- Only admins can list all users
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin role required';
  END IF;

  RETURN QUERY
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
END;
$$;

-- ============================================================
-- 5. Fix releases table — remove anon policies
-- ============================================================
DROP POLICY IF EXISTS "Anon can insert releases" ON releases;
DROP POLICY IF EXISTS "Anon can read releases" ON releases;

-- ============================================================
-- 6. Fix user_invitations — only admins can manage
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can read invitations" ON user_invitations;
DROP POLICY IF EXISTS "Authenticated users can insert invitations" ON user_invitations;
DROP POLICY IF EXISTS "Authenticated users can update invitations" ON user_invitations;

-- Admins can do everything with invitations
CREATE POLICY "Admins can read invitations"
  ON user_invitations FOR SELECT TO authenticated
  USING (is_admin());

CREATE POLICY "Admins can insert invitations"
  ON user_invitations FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "Admins can update invitations"
  ON user_invitations FOR UPDATE TO authenticated
  USING (is_admin());

-- Authenticated users can read their own invitation (needed during sign-up flow)
CREATE POLICY "Users can read own invitation"
  ON user_invitations FOR SELECT TO authenticated
  USING (lower(email) = lower(auth.email()));

-- Users can accept their own invitation (needed during sign-up flow in auth.js)
CREATE POLICY "Users can accept own invitation"
  ON user_invitations FOR UPDATE TO authenticated
  USING (lower(email) = lower(auth.email()))
  WITH CHECK (lower(email) = lower(auth.email()));

-- ============================================================
-- 7. Fix app_users — restrict insert to own record only
-- ============================================================
DROP POLICY IF EXISTS "Allow insert for authenticated" ON app_users;

-- Users can only insert their own app_user record (linked to their auth ID)
CREATE POLICY "Users can insert own app_user"
  ON app_users FOR INSERT TO authenticated
  WITH CHECK (auth_user_id = auth.uid());

-- ============================================================
-- 8. Fix app_users SELECT — users see own record, admins see all
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can read app_users" ON app_users;

-- Users can always read their own record
CREATE POLICY "Users can read own app_user"
  ON app_users FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

-- Admins can read all records
CREATE POLICY "Admins can read all app_users"
  ON app_users FOR SELECT TO authenticated
  USING (is_admin());

-- ============================================================
-- 9. Fix page_display_config — read for all auth, write for admin only
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can update page_display_config" ON page_display_config;
DROP POLICY IF EXISTS "Authenticated users can insert page_display_config" ON page_display_config;

CREATE POLICY "Admins can update page_display_config"
  ON page_display_config FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "Admins can insert page_display_config"
  ON page_display_config FOR INSERT TO authenticated
  WITH CHECK (is_admin());
