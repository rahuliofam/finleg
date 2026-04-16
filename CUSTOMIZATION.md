# Finleg Customizations

> This repo started as a fork of the [`alpacapps-infra`](https://github.com/rsonnad/alpacapps-infra) template and has since been heavily customized for the Sonnad family office. The generic `/setup-alpacapps-infra` flow does **not** apply to this repo anymore — it's for fresh template clones. This doc captures the finleg-specific deviations from the template.

## Stack overrides vs. template

| Area | Template default | Finleg |
|---|---|---|
| Routing | Next.js i18n with `/en/`, `/es/`, `/fr/` prefixes | i18n removed; routes are flat (commit `330f652`, 2026-03-14) |
| Domain | `USERNAME.github.io/REPO/` | `finleg.net` (custom CNAME) + GitHub Pages fallback |
| Supabase project | Template creates a new org | Uses existing `gjdvzzxsrzuorguwkaih` (SonFamFin, West US) |
| R2 account | n/a | `Rah Hui Lio Son Fami` Cloudflare account (`1417f040...`), migrated from `wingsiebird` in March 2026 (see `docs/R2-MIGRATION-CLEANUP.md`) |
| Auth model | Open sign-up | Invitation-only (`user_invitations` table); roles: admin / family / accountant / collaborator |
| Brand | Generic | Dark-green navbar (`#0f3d1e`), Playfair Display wordmark, Finleg logo |

## Family-office specifics

Finleg is built around the financial workflows of a single household, so it ships with data models and pages the template doesn't have:

- **File Vault** (`/intranet/files`) — browses ~1,880 financial documents indexed in Supabase (`document_index`) and stored in Cloudflare R2. Filters by institution, account type, holder, year.
- **Bookkeeping** (`/intranet/bookkeeping`) — tabs for Ledger Notes, Statements, QuickBooks sync, Zeni analysis, uploads summary.
- **QuickBooks integration** — production OAuth against Intuit "ClaudeCoded" app, realm `123146509258379`. Tables: `qb_tokens`, `qb_general_ledger`, `qb_transactions`, `category_rules`, `receipts`, `bookkeeping_activity_log`. See `docs/INTEGRATIONS.md`.
- **Schwab integration** — OAuth via Cloudflare Worker callback router, nightly token refresh cron. Tables: `schwab_accounts`, `schwab_api_log`.
- **Tax / property / insurance docs** — tax returns 2020–2025, property docs for Alpaca Playhouse and WA Sharingwood, insurance policies, credit reports.
- **Holders** — data is tagged per household member (Rahul, Subhash, Trust). Display names are mapped in `src/lib/`.
- **Open Brain** — semantic memory table (`thoughts` with pgvector 768-dim embeddings) and `ingest-thought` edge function, populated from Slack and MCP server.
- **DevControl** (`/intranet/devcontrol`, formerly "clauded") — internal ops dashboard: releases, sessions, token usage, context snapshots, planlist, backups, AutoActions, Flow Migration.

## Config that would change if re-forked

If you clone this repo intending to build a different family office, these are the things you'd need to retarget:

| File | What's finleg-specific |
|---|---|
| `CNAME` | `finleg.net` |
| `next.config.ts` | `basePath: ""` (domain-hosted, not GitHub Pages subpath) |
| `src/lib/supabase.ts` / `shared/supabase.js` | Supabase URL + anon key (finleg project) |
| `shared/brand-config.js`, `src/app/globals.css` | Dark-green brand tokens, Playfair wordmark |
| `src/app/layout.tsx` | Metadata title/description |
| `src/contexts/auth-context.tsx` | Google OAuth redirect to `/intranet` (no `/en/` prefix) |
| `supabase/migrations/*` | All finleg-specific tables (statements, QB, Schwab, document_index, thoughts, etc.) |
| `scripts/*` | Hardcoded paths like `/Users/rahulio/.../Current Sonnad Accounting Files...` |
| `docs/DATA-ARCHITECTURE.md` | Account numbers, balances, holder names |

## What `/setup-alpacapps-infra` still does here

The skill still exists under `.claude/skills/` but is mostly redundant for this repo. Useful pieces:

- Deploying Supabase edge functions via `SUPABASE_ACCESS_TOKEN` (see `CLAUDE.md` → Supabase CLI Multi-Account)
- Updating the `docs/CREDENTIALS.md` file (gitignored) when new services come online
- Running SQL migrations through `scripts/run-migration.sh` (with pre-migration dumps)

For truly new service integrations (e.g., adding a new bank), prefer:

1. Add edge function under `supabase/functions/<name>/` and deploy via the command in `CLAUDE.md`.
2. Add a migration under `supabase/migrations/NNN_<name>.sql` and run with `scripts/run-migration.sh`.
3. Document in `docs/INTEGRATIONS.md` and (if data flows through) `docs/DATA-ARCHITECTURE.md`.

## Syncing from the template

If useful features land in `alpacapps-infra` upstream, the `/sync-updates` skill can cherry-pick them. In practice, finleg has diverged enough (no i18n, different auth, custom data model) that template syncs are rare.
