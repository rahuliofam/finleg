# Key Files Reference

> This file is loaded on-demand. Referenced from CLAUDE.md.

## Shared Modules (`/shared/`)

- `supabase.js` — Supabase client singleton (anon key embedded)
- `auth.js` — Authentication module (profile button, login modal, page guard)
- `admin.css` — Admin styles: layout, tables, modals, badges (themeable via CSS custom properties)

## Configuration

- `shared/supabase.js` — Supabase URL + anon key (must export globals)
- `styles/tailwind.css` — Tailwind v4 CSS-first config with `@theme` tokens
- `version.json` — Auto-bumped by CI on every push

## Admin Pages (`/admin/`)

- Each page: loads `shared/admin.css`, calls `requireAuth(callback)`
- Pattern: topbar nav links between sub-pages, table listing + modal forms

## Build & Scripts

- `npm run css:build` — Rebuild Tailwind output
- `npm run css:watch` — Watch mode for development
- `scripts/bump-version.sh` — CI version bump (never run locally)

<!-- Add more key files as the project grows -->
