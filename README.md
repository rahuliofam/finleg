# Finleg

Private family-office platform for the Sonnad family. Handles document vaulting, bookkeeping, QuickBooks / Schwab / Plaid integrations, and a family intranet.

Not for public consumption. This repo is a fork of the `alpacapps-infra` template, heavily customized for finleg's workflows.

## Tech Stack

- **Frontend:** Next.js 16 (App Router, statically exported) + React 19 + TypeScript
- **Styling:** Tailwind CSS v4 (CSS-first via `@theme` block in `src/app/globals.css`)
- **Backend:** Supabase (Postgres + Auth + Edge Functions + pgvector)
- **Edge compute:** Cloudflare Workers (OAuth callbacks, R2 file proxy, Claude session archive on D1)
- **Object storage:** Cloudflare R2 (~1,880 financial documents)
- **Hosting:** GitHub Pages (static export, served at [finleg.net](https://finleg.net))
- **Batch / AI jobs:** Hostinger VPS + Claude CLI in headless mode (`claude --print`); some Mac-local nightly jobs (photo captioning, embeddings) on Alpuca Mac

## Live URLs

| Environment | URL |
|---|---|
| Production | [finleg.net](https://finleg.net) |
| GitHub Pages | [rahuliofam.github.io/finleg](https://rahuliofam.github.io/finleg/) |

## Repo layout (high level)

- `src/app/` — Next.js App Router pages (`intranet/`, `devcontrol/`, `sessions/`, `legal/`, `signin/`, etc.)
- `src/components/`, `src/contexts/`, `src/hooks/`, `src/lib/` — React UI
- `shared/` — legacy client-side helpers (auth, Supabase client, brand config) still used by a few static pages
- `supabase/migrations/` — SQL migrations (001–027+)
- `supabase/functions/` — Deno edge functions (qb-sync, schwab-sync, ingest-thought, send-invitation-email, etc.)
- `cloudflare/` — Workers (`claude-sessions` + D1, `r2-files`, `schwab-oauth`, `schwab-callback-router`)
- `scripts/` — Node/Bash batch scripts (QB ingestion, R2 uploads, OCR, backups)
- `docs/` — Project docs (loaded on-demand by Claude; see `CLAUDE.md`)

## Local dev

```bash
npm install
npm run dev          # Next.js dev server
npm run lint
npm run build        # static export to out/
```

Environment variables live in `local.env` (gitignored). See `docs/INTEGRATIONS.md` and `docs/CREDENTIALS.md` (gitignored) for what's expected.

## Deployment

Push to `main` — GitHub Actions runs `deploy.yml` (build Next.js → deploy `out/` to Pages) and `bump-version-on-push.yml` (auto-bump version, insert `releases` row). See `docs/DEPLOY.md`.

## Docs (on-demand context system)

`CLAUDE.md` is loaded every conversation; other docs are loaded only when the task matches. See `CLAUDE.md` for the loader index. Highlights:

- `docs/SCHEMA.md` — Supabase tables and relationships
- `docs/PATTERNS.md` — code conventions, Tailwind tokens, auth patterns
- `docs/KEY-FILES.md` — file structure tour
- `docs/DEPLOY.md` — deploy + version workflow
- `docs/INTEGRATIONS.md` — external services (QuickBooks, Resend, Telnyx, Square, Stripe, SignWell, Gemini, R2)
- `docs/DATA-ARCHITECTURE.md` — where data lives and how it flows
- `docs/BACKUP-RECOVERY.md` — backup/restore runbooks
- `docs/REMOTE-ACCESS.md` — Hostinger + Alpuca Mac SSH
- `docs/STATEMENT-INGESTION.md` — PDF statement → Supabase pipeline plan
- `docs/PHOTO-CAPTION-OPERATIONS.md` — Moondream nightly job runbook
- `docs/R2-MIGRATION-CLEANUP.md` — old wingsiebird R2 cleanup plan
- `docs/CHANGELOG.md` — notable changes

## License

AGPL-3.0 — see [LICENSE](LICENSE).
