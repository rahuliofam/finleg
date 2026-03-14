# Database Schema Reference

> This file is loaded on-demand. Referenced from CLAUDE.md.
> Updated by the setup wizard and as tables are added/modified.

## Core Tables

```sql
app_users (
  id UUID PK,
  auth_id UUID UNIQUE,        -- links to Supabase auth.users
  email TEXT,
  display_name TEXT,
  role TEXT ('admin'|'user'|'viewer'),
  avatar_url TEXT,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)

ai_sessions (
  id UUID PK,
  user_id UUID FK→app_users,
  title TEXT,
  model TEXT DEFAULT 'gemini-2.5-flash',
  system_prompt TEXT,
  metadata JSONB,
  is_archived BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)

ai_messages (
  id UUID PK,
  session_id UUID FK→ai_sessions ON DELETE CASCADE,
  role TEXT ('user'|'assistant'|'system'),
  content TEXT,
  tokens_used INT,
  model TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ
)

app_config (
  id INT PK DEFAULT 1 (singleton),
  site_name TEXT DEFAULT 'FinLeg',
  features JSONB,
  is_active BOOLEAN,
  updated_at TIMESTAMPTZ
)
```

## Service Config Tables

Created when optional services are enabled:

```
(added as services are configured)
```

## Common Patterns

- All tables use UUID primary keys
- All tables have `created_at` and `updated_at` timestamps
- RLS is enabled on all tables
- `is_archived` flag for soft deletes (filter client-side)
