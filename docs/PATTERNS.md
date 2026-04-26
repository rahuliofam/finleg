# Common Patterns & Conventions

> This file is loaded on-demand. Referenced from CLAUDE.md.
> Finleg is Next.js 16 (App Router, static export) + React 19 + TypeScript + Tailwind v4. Some legacy static pages still use vanilla JS helpers under `shared/`.

## Tailwind v4 Design Tokens

Tailwind v4 uses CSS-first config — there is **no** `tailwind.config.js`. Tokens live in `src/app/globals.css` inside `@theme inline { ... }`. Example:

```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-brand: var(--brand-green);
  --color-brand-dark: var(--brand-green-dark);
  --color-brand-light: var(--brand-green-light);
  --color-brand-blue: var(--brand-blue);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
  --font-display: var(--font-playfair);
}
```

After changing tokens, Next.js's PostCSS pipeline rebuilds CSS automatically on `npm run dev` / `npm run build`. The `npm run css:build` script is a no-op kept for CI compatibility.

## Auth

### React app (`src/`)

Google OAuth via Supabase Auth. `src/contexts/auth-context.tsx` exposes the current user + supabase client via React context.

- Intranet layout (`src/app/intranet/layout.tsx`) gates access; unauthenticated users are redirected to `/signin`.
- Role-based UI uses the `role` column on `app_users` (admin / family / accountant / collaborator).
- Sessions/invitations: admins create rows in `user_invitations`; only invited emails can sign up. See migrations `005`, `006`.

### Legacy static pages (`shared/`)

A handful of static HTML pages still load `shared/auth.js`:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
<script src="shared/supabase.js"></script>
<script src="shared/auth.js"></script>
```

- `requireAuth(callback)` — redirects if signed out, else invokes `callback(user, supabase)`
- Profile button + login modal auto-insert into the nav

New work should live in the Next.js app unless there's a reason not to.

## UI conventions

1. Use inline error/success banners for form feedback — never `alert()`. Wrap form pages in the `<ErrorBoundary>` from `src/components/error-boundary.tsx` and use the `useForm` hook + validation lib (see `docs/FORMS.md`).
2. Filter archived items client-side: `.filter(s => !s.is_archived)`
3. Don't expose personal info (emails, phone numbers, balances) in public / consumer views
4. Client-side image compression for uploads > 500KB
5. Image lightbox: each tab that shows photos has its own modal pattern (e.g., `_photos.tsx`, `_general.tsx`). There is no global `openLightbox()` helper — copy the local pattern when you add a new image-viewing surface.
6. Admin tables use the intranet's shared table components in `src/components/`

## Data access

- Client-side reads go through the Supabase browser client (`src/lib/supabase.ts`) with RLS enforced.
- Service-role work (migrations, bulk scripts) uses `SUPABASE_SERVICE_ROLE_KEY` from `local.env` — never embedded in shipped JS.
- Every table has RLS enabled, UUID primary key, `created_at` + `updated_at` timestamps.

## Secrets

- **Bitwarden** is the sole password manager (all 1Password references were migrated in commit `3bb26cb`, 2026-03-17).
- Gitleaks pre-commit hook enforces no hardcoded secrets (`.githooks/`, added in `e00df1e`).
- `local.env` (gitignored) holds runtime env vars. `docs/CREDENTIALS.md` (gitignored) mirrors it in prose.
- Supabase edge function secrets are set via `supabase secrets set` — see `docs/INTEGRATIONS.md`.

## Batch / AI work

- Use **Hostinger VPS** for long-running batch jobs (see `docs/REMOTE-ACCESS.md`).
- Use **Claude CLI headless mode** (`claude --print`) in scripts rather than the Anthropic SDK where possible — it handles auth, retries, and model aliasing.
- Rate limit external calls (Claude / Gemini / QB) to stay within free/low-cost tiers.

## Versioning & deploys

- CI bumps `version.json` on every push (`vYYMMDD.NN H:MMa`) — never bump locally.
- Every push to `main` triggers `.github/workflows/deploy.yml` (Next.js build → GitHub Pages `out/`) and `.github/workflows/bump-version-on-push.yml` (insert `releases` row). See `docs/DEPLOY.md`.
