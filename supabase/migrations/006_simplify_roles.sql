-- Simplify roles to: admin, family, accountant, collaborator

-- Update any existing users with old roles to 'collaborator' as fallback
UPDATE app_users SET role = 'collaborator'
WHERE role NOT IN ('admin', 'family', 'accountant', 'collaborator');

-- Drop and recreate CHECK constraint on app_users
ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
ALTER TABLE app_users ADD CONSTRAINT app_users_role_check
  CHECK (role IN ('admin', 'family', 'accountant', 'collaborator'));

-- Update any existing invitations with old roles
UPDATE user_invitations SET role = 'collaborator'
WHERE role NOT IN ('admin', 'family', 'accountant', 'collaborator');

-- Drop and recreate CHECK constraint on user_invitations
ALTER TABLE user_invitations DROP CONSTRAINT IF EXISTS user_invitations_role_check;
ALTER TABLE user_invitations ADD CONSTRAINT user_invitations_role_check
  CHECK (role IN ('admin', 'family', 'accountant', 'collaborator'));
