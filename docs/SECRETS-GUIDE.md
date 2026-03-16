# Security & Secrets Guide

> Last reviewed: 2026-03-16

## Current Status

### Already in place
- `.env` is gitignored; `.env.example` has only placeholders
- Gitleaks pre-commit hook installed (`.githooks/pre-commit`)
- `npm prepare` auto-configures hooks for new clones
- Supabase anon key (public by design) is the only JWT in committed code
- PKCE auth flow prevents authorization code interception
- RLS enabled on all tables
- `docs/CREDENTIALS.md` is gitignored
- Scripts use `process.env` + dotenv (post-GitGuardian remediation)

### Open Issues

#### 1. Cloudflare Worker placeholder auth token (HIGH)
- **File:** `cloudflare/claude-sessions/src/index.js:5`
- **Problem:** `AUTH_TOKEN = 'CHANGE_ME_TO_A_SECRET'` is hardcoded. If deployed, either using this weak default or a real token baked into source.
- **Fix:** Use `env.AUTH_TOKEN` (Cloudflare Worker secret) instead of a constant. Set via `wrangler secret put AUTH_TOKEN`.

#### 2. CORS wide open on Cloudflare Worker (MEDIUM)
- **File:** `cloudflare/claude-sessions/src/index.js` — `corsHeaders()`
- **Problem:** `Access-Control-Allow-Origin: '*'` lets any website call this API with a valid bearer token.
- **Fix:** Restrict to actual domain(s) — e.g., `https://rsonnad.github.io`.

#### 3. Gitleaks hook silently skips if not installed (MEDIUM)
- **File:** `.githooks/pre-commit`
- **Problem:** Hook prints a warning but exits 0 when gitleaks isn't found. Commits proceed unscanned on new machines or CI.
- **Fix:** Exit 1 if gitleaks is not installed (fail-closed).

#### 4. `todo.html` exposes remediation details publicly (LOW)
- **File:** `todo.html`
- **Problem:** Committed and served on GitHub Pages. Contains Supabase project ref and details about which keys were exposed.
- **Fix:** Delete file or move to gitignored location once remediation is complete.

#### 5. No client-side password complexity enforcement (LOW)
- **File:** `shared/auth.js` — `signUpWithPassword()`, `updatePassword()`
- **Problem:** Passwords go straight to Supabase with no minimum length check. Supabase default minimum is 6 characters.
- **Fix:** Add client-side validation requiring 12+ characters before calling Supabase.

#### 6. Auth cache persists 7 days in localStorage (LOW)
- **File:** `shared/auth.js` — `CACHED_AUTH_MAX_AGE_MS`
- **Problem:** Cached auth state (role, identity) persists for a week. Physical device access reveals cached identity.
- **Note:** Intentional UX tradeoff — just be aware of the risk on shared devices.
