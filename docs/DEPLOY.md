# Deployment Workflow

## GitHub Pages (Next.js static export)

Finleg deploys from `main` to GitHub Pages via two workflows in `.github/workflows/`:

- `deploy.yml` — builds Next.js (`next build` → static `out/`) and publishes to Pages.
- `bump-version-on-push.yml` — bumps `version.json` and inserts a row into the `releases` Supabase table.

Pushes to `main` trigger both automatically. `deploy.yml` can also be triggered manually from the Actions tab.

### Push workflow

```bash
git add -A && git commit -m "message" && git push
```

### Post-push verification

1. Wait ~60–120s for CI (build + deploy takes longer than a static site would).
2. `git pull --rebase origin main` to pick up the CI version bump.
3. Read `version.json` to confirm the new version number.
4. Visit [finleg.net](https://finleg.net) to confirm the change is live.

### Version format

`vYYMMDD.NN H:MMa` — date + daily counter + local time (e.g. `v260325.03 3:10p`). CI-bumped only. **Never bump locally.**

## Live URLs

| Environment | URL |
|---|---|
| Production | https://finleg.net |
| GitHub Pages | https://rahuliofam.github.io/finleg/ |

Both URLs serve the same build. `CNAME` (finleg.net) is committed at repo root.

## Tailwind CSS

Tailwind v4 is compiled by Next.js via PostCSS on every `next build`. No separate `css:build` step is needed — the npm script is a no-op kept for CI compatibility with the template's bump-version flow.

## Cloudflare Workers

Workers under `cloudflare/` deploy separately with `wrangler deploy` (run from the respective subdir). They are **not** part of the main GitHub Pages workflow:

- `cloudflare/claude-sessions/` — Claude session archive + D1 DB
- `cloudflare/r2-files/` — R2 file proxy
- `cloudflare/schwab-oauth/`, `cloudflare/schwab-callback-router/` — Schwab OAuth flow

## Supabase edge functions

Deploy via the management-token command in `CLAUDE.md` (Supabase CLI Multi-Account section). Edge functions are **not** part of `deploy.yml`.

## GitHub Secrets

- `SUPABASE_DB_URL` — used by `bump-version-on-push.yml` to write into the `releases` table.
