---
name: sync-updates
description: Sync new features from the AlpacApps template repo into a previously cloned project. Use when user says "sync updates", "get new features", "update from template", "what's new in alpacapps", "catch up with template", or "adopt new features".
---

# AlpacApps Update Sync

You help users who previously cloned the AlpacApps template repo adopt new features that have been added since their clone.

## How It Works

1. **Detect what the user already has** — check their project for existing features.
2. **Show what's available** — present the feature list with descriptions.
3. **Let the user choose** — ask which features they want to adopt.
4. **Set up each feature** — one at a time, commit after each.

## Step 1: Detect Current State

Check for these indicators:
- `cloudflare/claude-sessions/` exists? → D1 session logging already present
- `~/.claude/hooks/save-session.sh` exists? → Hook installed
- `~/.claude/settings.json` has `Stop` hook? → Stop hook configured (vs older `SessionEnd`)
- `docs/` directory with 7+ .md files? → On-demand context system present
- `open-brain/index.html` exists? → Open Brain dashboard present
- `shared/services/poll-manager.js` exists? → Poll manager present
- `shared/supabase-health.js` exists? → Health check present
- `shared/error-logger.js` exists? → Error logger present
- `supabase/migrations/001_page_display_config.sql` exists? → Tab visibility present

## Step 2: Present Available Updates

Show only the features the user does NOT already have. For each one, provide a brief description:

| Feature | Description | Requires |
|---------|-------------|----------|
| **D1 Session Logging** | Auto-save Claude Code transcripts to Cloudflare D1 | Cloudflare account |
| **On-Demand Context System** | Split CLAUDE.md into slim index + on-demand docs/ files | Nothing |
| **Open Brain Dashboard** | View session history, search transcripts, track costs | D1 Session Logging |
| **Smart Polling (Circuit Breaker)** | PollManager with backoff, visibility API, auto-recovery | Supabase |
| **Tab Visibility Config** | Database-driven intranet tab show/hide | Supabase |
| **Centralized Error Logger** | Standardized error capture utility | Nothing |
| **Stop Hook Upgrade** | Replace SessionEnd with Stop hook (captures worktrees) | D1 Session Logging |

Ask the user which features they want. You can also point them to the visual updates page at `infra/updates.html` if they want to browse interactively.

## Step 3: Adopt Features

For each selected feature, pull files from the template repo and configure them. The canonical instructions for each feature are in `infra/updates.html` — read that file for the exact steps.

### General approach for pulling files from template

```bash
# Add the template as a remote (if not already)
git remote add template https://github.com/rsonnad/alpacapps-infra.git 2>/dev/null || true

# Fetch latest template
git fetch template main

# Cherry-pick specific files/directories
git checkout template/main -- path/to/file/or/directory
```

After pulling files, customize them for the user's project (replace placeholder values, wire into existing code).

### Per-feature rules

**D1 Session Logging:**
- Generate a secure random auth token: `openssl rand -hex 32`
- Replace `CHANGE_ME_TO_A_SECRET` in `src/index.js`
- Replace `YOUR_DATABASE_ID_HERE` in `wrangler.jsonc`
- Replace placeholders in `hooks/save-session.sh`
- The hook goes in `~/.claude/hooks/` (user's home, not project)
- Use the `Stop` event, NOT `SessionEnd`

**On-Demand Context:**
- PRESERVE any custom content the user has in CLAUDE.md
- Only slim down the structure, don't lose their directives
- Migrate existing inline docs to the right docs/*.md file

**Open Brain:**
- This is a NEW page to create (not pulled from template — it doesn't exist in template yet)
- Build it as a standalone HTML page at `open-brain/index.html`
- Must work with the user's D1 Worker URL and auth token
- Ask: public or auth-gated?

**Stop Hook Upgrade:**
- Check if they have `SessionEnd` in settings.json — if so, replace with `Stop`
- If they already have `Stop`, skip this feature entirely

## Step 4: Validate and Document

After each feature:
1. Validate it works (run a test command, check endpoints, etc.)
2. Update `docs/CHANGELOG.md` with what was added
3. Update `docs/KEY-FILES.md` if new files were created
4. Update `docs/INTEGRATIONS.md` if external services were added
5. Commit with a descriptive message: `feat: adopt [feature name] from template`
6. Push to remote

## Step 5: Summary

After all features are set up, show a summary:
- What was adopted
- Any manual follow-up steps needed
- Links to relevant docs
