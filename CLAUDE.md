# Finleg — Project Directives

> **On-demand docs — load when the task matches:**
> - `docs/CREDENTIALS.md` — **load for:** SQL queries, deploying functions, SSH, API calls
> - `docs/SCHEMA.md` — **load for:** writing queries, modifying tables, debugging data
> - `docs/PATTERNS.md` — **load for:** writing UI code, Tailwind styling, code review, testing
> - `docs/KEY-FILES.md` — **load for:** finding files, understanding project structure
> - `docs/DEPLOY.md` — **load for:** pushing, deploying, version questions
> - `docs/INTEGRATIONS.md` — **load for:** external APIs, vendor setup, pricing
> - `docs/CHANGELOG.md` — **load for:** understanding recent changes, migration context

> **Note:** Finleg is a customized fork of the `alpacapps-infra` template. The `/setup-alpacapps-infra` skill is for fresh clones and does not need to be re-run here. See `CUSTOMIZATION.md` for what was customized.

## Mandatory Behaviors

1. After code changes: end response with `vYYMMDD.NN H:MMa [model]` + affected URLs (read `version.json`)
2. Push immediately — GitHub Pages deploys on push to main. See `docs/DEPLOY.md`
3. CI bumps version — never bump locally
4. Run SQL migrations directly — never ask the user to run SQL manually

## Code Guards

- Filter archived items: `.filter(s => !s.is_archived)` client-side
- No personal info in consumer/public views
- `showToast()` not `alert()` in admin
- `openLightbox(url)` for images
- Tailwind v4: use design tokens from the `@theme` block in `src/app/globals.css` (see `docs/PATTERNS.md`). Next.js rebuilds CSS via PostCSS automatically — no manual `css:build` step.

## Batch Processing

- **Always use Hostinger VPS** for batch jobs (document parsing, bulk extraction, long-running scripts)
- **Use Claude CLI headless mode** (`claude --print`) instead of Anthropic SDK for all AI-powered batch processing
- **Hostinger SSH:** `sshpass -f ~/.ssh/alpacapps-hostinger.pass ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no root@93.188.164.224`
- **Prerequisites on Hostinger:** Claude CLI (`npm i -g @anthropic-ai/claude-code`), wrangler (`npm i -g wrangler`), Node 22+

## Supabase CLI Multi-Account

The CLI uses `SUPABASE_ACCESS_TOKEN` env var to authenticate. Tokens are in Bitwarden.

| Project | Ref | Token (Bitwarden) |
|---|---|---|
| **finleg** | `gjdvzzxsrzuorguwkaih` | "Supabase - finleg" → notes → ClaudeSupaAuto Mgmt Token |
| **alpacapps** | `aphrrfprbixmhissnjfn` | "Supabase — AlpacApps Project" → notes → Management API Token |

**Deploy edge functions:**
```bash
# Finleg
export BW_SESSION=$(~/bin/bw-unlock)
SUPABASE_ACCESS_TOKEN=$(bw get notes "Supabase - finleg" | grep "Mgmt Token" | cut -d' ' -f4) \
  npx supabase functions deploy <function-name> --no-verify-jwt --project-ref gjdvzzxsrzuorguwkaih

# AlpacApps
SUPABASE_ACCESS_TOKEN=$(bw get notes "Supabase — AlpacApps Project" | grep "Management API Token" | cut -d' ' -f4) \
  npx supabase functions deploy <function-name> --no-verify-jwt --project-ref aphrrfprbixmhissnjfn
```

## Quick Refs

- **Tech:** Next.js 16 (App Router, static export) + React 19 + TypeScript + Tailwind v4 | Supabase (Postgres + Auth + Edge Functions) | Cloudflare Workers + R2 + D1 | GitHub Pages | Hostinger VPS (batch jobs)
- **Live:** https://finleg.net (also https://rahuliofam.github.io/finleg/)
- **Architecture:** Browser → GitHub Pages (static export of Next.js) → Supabase for DB/Auth; Cloudflare Workers for OAuth callbacks, R2 file proxy, and Claude session archive; Hostinger VPS runs nightly batch/AI scripts.
