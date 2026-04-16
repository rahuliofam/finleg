# Key Files Reference

> This file is loaded on-demand. Referenced from CLAUDE.md.
> Finleg is a Next.js 16 (App Router, static export) + React 19 + TypeScript app. The bulk of UI lives under `src/`; a handful of legacy static helpers live under `shared/`.

## Next.js App (`src/`)

- `src/app/layout.tsx` — root layout, metadata, fonts (Geist + Playfair)
- `src/app/globals.css` — Tailwind v4 entry (`@import "tailwindcss"`), brand color vars, `@theme inline` token mapping
- `src/app/page.tsx` — public homepage
- `src/app/signin/` — sign-in page
- `src/app/intranet/` — auth-gated family intranet
  - `admin/` — user management, releases, brand, uploads summary
  - `bookkeeping/` — ledger notes, statements, QuickBooks, Zeni analysis
  - `files/` — File Vault (R2 document browser with filters)
  - `devcontrol/` — ops dashboard (formerly "clauded"): sessions, tokens, planlist, backups, AutoActions, Flow Migration
  - `my/`, `residents/`, `associates/`, `staff/`, `devices/`, `zeni/`, `howto/` — other intranet sections
- `src/app/sessions/` — Claude session viewer (public read of archived transcripts)
- `src/app/legal/` — terms + privacy pages
- `src/contexts/auth-context.tsx` — Supabase auth provider, Google OAuth redirect handling
- `src/lib/supabase.ts` — Supabase browser client
- `src/lib/version.ts` — reads `version.json`
- `src/components/`, `src/hooks/`, `src/types/` — shared React building blocks

## Legacy Static Helpers (`shared/`)

Used by a few static pages and some scripts; gradually being superseded by `src/lib/`.

- `shared/supabase.js` — Supabase client singleton (anon key embedded)
- `shared/auth.js` — legacy profile button + login modal + `requireAuth()` guard
- `shared/admin.css` — admin table/modal styles
- `shared/brand-config.js` — brand colors + logo URLs
- `shared/config-loader.js`, `shared/feature-registry.js`, `shared/site-components.js` — client-side config and component helpers
- `shared/update-checker.js`, `shared/version-info.js` — version banner logic

## Supabase (`supabase/`)

- `supabase/migrations/NNN_*.sql` — numbered migrations (001 through 027+). See `docs/SCHEMA.md` for the current table list.
- `supabase/functions/<name>/index.ts` — Deno edge functions. Notable:
  - `qb-sync`, `qb-sync-scheduled`, `qb-writeback`, `qb-integrity-check` — QuickBooks sync pipeline
  - `schwab-sync`, `schwab-sync-scheduled` — Schwab brokerage sync
  - `ingest-thought`, `open-brain-mcp` — Open Brain semantic memory
  - `resend-inbound-webhook` — inbound email → statement pipeline
  - `send-invitation-email`, `send-weekly-digest` — transactional email
  - `resolve-tax-conflict`, `quick-action` — interactive email action endpoints

## Cloudflare Workers (`cloudflare/`)

- `cloudflare/claude-sessions/` — Worker + D1 DB for Claude session archive (API at `claude-sessions.finleg.workers.dev`)
- `cloudflare/r2-files/` — R2 file proxy worker (signed file access for File Vault)
- `cloudflare/schwab-oauth/` — Schwab OAuth callback handler
- `cloudflare/schwab-callback-router/` — dynamic OAuth target switcher (dev vs prod)

## Scripts (`scripts/`)

Batch jobs (run locally, on Hostinger, or on Alpuca Mac):

- `upload-r2-index.mjs` — bulk upload accounting files → R2 + `document_index`
- `upload-family-docs.mjs`, `upload-legal-docs.mjs` — category-specific uploads
- `ingest-qb-ledger.mjs` — import QB General Ledger CSV
- `ingest-statements.mjs` — PDF statement extraction → Supabase (via Claude CLI)
- `extract-doc-text.mjs`, `extract-doc-metadata.mjs` — text + metadata extraction
- `ocr-gemini-flash.mjs`, `ocr-scanned-pdfs.mjs` — OCR for image-only PDFs
- `ai-categorize-batch.mjs`, `seed-category-rules.mjs` — transaction categorization
- `process-inbox.mjs` — process inbound email attachments
- `process-tax-returns.mjs` — tax return extraction w/ conflict resolution
- `qb-refresh-token.mjs`, `qb-oauth-server.mjs`, `qb-gl-compare.mjs`, `test-quickbooks.mjs` — QuickBooks tooling
- `sync-investment-balances-to-qb.mjs` — push Schwab balances into QB
- `schwab-manual-auth.mjs` — one-off Schwab token bootstrap
- `compute-ai-metrics.mjs` — weekly AI accuracy rollup
- `fix-missing-index.mjs`, `verify-index.mjs` — `document_index` repair/validation
- `backup-db-to-r2.sh`, `backup-finleg-to-rvault.sh` — backup runners (see `docs/BACKUP-RECOVERY.md`)
- `run-migration.sh` — migration wrapper with pre-dump safety
- `bump-version.sh` — CI version bump (never run locally)
- `push-main.sh`, `upload-to-r2.sh`, `cloudflared` — convenience scripts

## Configuration

- `next.config.ts` — Next.js config (`output: "export"`, `basePath: ""`, unoptimized images)
- `tsconfig.json` — TypeScript config
- `eslint.config.mjs` — ESLint (Next.js preset)
- `postcss.config.mjs` — PostCSS (Tailwind v4 plugin)
- `package.json` — `dev` / `build` / `start` / `lint`; `css:build` is a no-op kept for CI compatibility
- `version.json` — CI-bumped on every push; format `vYYMMDD.NN H:MMa`
- `CNAME` — `finleg.net`

## Static Assets & Translations

- `public/` — static assets served by Next.js
- `translations/GEMINI_PROMPT.md` — template prompt for Gemini-based translation (legacy, i18n system removed in 2026-03-14 `330f652`)
- `en/` — legacy static folder (pre-Next.js redirect target)
- `index.html`, `todo.html` — root-level HTML files used as redirect/landing fallbacks

## Build & Scripts

```bash
npm run dev          # Next.js dev server (hot reload)
npm run build        # Static export → out/
npm run start        # Serve built output
npm run lint         # ESLint
```

Tailwind v4 is CSS-first — tokens are declared in `src/app/globals.css` inside `@theme inline`. There is no `tailwind.config.js`. Next.js rebuilds CSS via PostCSS on every build; the `css:build` npm script is a no-op kept so the template's CI version-bump workflow doesn't break.
