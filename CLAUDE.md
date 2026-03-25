# [Your Project Name] — Project Directives

> **On-demand docs — load when the task matches:**
> - `docs/CREDENTIALS.md` — **load for:** SQL queries, deploying functions, SSH, API calls
> - `docs/SCHEMA.md` — **load for:** writing queries, modifying tables, debugging data
> - `docs/PATTERNS.md` — **load for:** writing UI code, Tailwind styling, code review, testing
> - `docs/KEY-FILES.md` — **load for:** finding files, understanding project structure
> - `docs/DEPLOY.md` — **load for:** pushing, deploying, version questions
> - `docs/INTEGRATIONS.md` — **load for:** external APIs, vendor setup, pricing
> - `docs/CHANGELOG.md` — **load for:** understanding recent changes, migration context

> **IMPORTANT: First-time setup!**
> Run `/setup-alpacapps-infra` to set up the full infrastructure interactively.

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
- Tailwind: use design tokens from `@theme` block (see `docs/PATTERNS.md`). Run `npm run css:build` after new classes.

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

- **Tech:** Vanilla HTML/JS + Tailwind v4 | Supabase | GitHub Pages
- **Live:** https://USERNAME.github.io/REPO/
- **Architecture:** Browser → GitHub Pages → Supabase (no server-side code)
