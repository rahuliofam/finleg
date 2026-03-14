# AlpacApps Infra

A starter template for building full-stack business platforms with Claude Code. Set up messaging, marketing, customer management, and finance — all on free or near-free infrastructure.

## What you get

- **Database + Auth + Storage** — Supabase (free)
- **Website + Hosting** — GitHub Pages (free)
- **Login + Admin Dashboard** — Profile button, login modal, admin CRUD pages (included)
- **Email** — Resend (free, 3,000/month)
- **SMS** — Telnyx (~$0.004/message)
- **Payments** — Square (2.9% + 30¢)
- **E-Signatures** — SignWell (free, 3–25 docs/month)
- **AI Features** — Google Gemini (free)
- **Cloud Server** — Any VPS provider: DigitalOcean, Hostinger, AWS EC2, Google Cloud ($4-12/mo)
- **AI Developer** — Claude Code (builds and manages everything)

## Prerequisites

Before starting, make sure you have:

| Tool | Install |
|------|---------|
| **Git** | [git-scm.com/downloads](https://git-scm.com/downloads) (Mac has it built in) |
| **Claude Code** | [docs.anthropic.com/claude-code](https://docs.anthropic.com/en/docs/claude-code/overview) (installs Node.js automatically) |
| **GitHub account** | [github.com/signup](https://github.com/signup) (free) |

Quick check — paste into your terminal:
```bash
git --version && claude --version
```
Both should print version numbers.

## Quick start

**1. Clone this repo** — replace `my-project` with your project name (lowercase, hyphens, no spaces):
```bash
git clone https://github.com/rsonnad/alpacapps-infra.git my-project
cd my-project
```

**2. Open Claude Code** — you must be inside the project folder:
```bash
claude
```

**3. Run the setup wizard:**
```
/setup-alpacapps-infra
```

That's it. Claude creates your own GitHub repo, disconnects from this template, walks you through setting up each service, and pushes everything live.

> **⚠️ "Skill not found"?** You're not inside the cloned folder. The skill lives at `.claude/skills/` inside the project. Run `pwd` to check, then `cd my-project` if needed.

## What happens during setup

The setup wizard will:
1. Ask what you're building and which services you need
2. Create a new GitHub repo under your account
3. Disconnect from the `alpacapps-infra` template origin
4. Customize the codebase for your organization (branding, basePath, i18n)
5. Set up Supabase (create org + project), deploy edge functions, configure webhooks
6. Scaffold login/auth system and admin CRUD pages for your entities
7. Build your context docs (`CLAUDE.md` + `docs/*.md`) with credentials, schema, and patterns
8. Push everything to your new repo — your site goes live on GitHub Pages

## After setup

The project uses an **on-demand context system** to keep Claude fast and efficient:

- **`CLAUDE.md`** (~30 lines) is loaded every conversation — contains project directives and an index
- **`docs/*.md`** files are loaded only when needed:
  - `CREDENTIALS.md` — API keys, tokens (gitignored, never committed)
  - `SCHEMA.md` — database tables and relationships
  - `PATTERNS.md` — code conventions, Tailwind tokens, auth system
  - `KEY-FILES.md` — project file structure
  - `DEPLOY.md` — deployment workflow and live URLs
  - `INTEGRATIONS.md` — external services and cost tiers
  - `CHANGELOG.md` — recent changes

Claude loads only what it needs per task — saving thousands of tokens per conversation. Just tell Claude what to build.

## Customization

See [CUSTOMIZATION.md](CUSTOMIZATION.md) for a detailed guide on what gets customized for each new organization and how to modify the template.

## Tech Stack

- **Frontend:** Next.js 16 (React 19, TypeScript, Tailwind CSS)
- **Backend:** Supabase (PostgreSQL + Storage + Auth)
- **Hosting:** GitHub Pages (static export)
- **i18n:** Dictionary-based multi-language support (English, Spanish, French by default)

## Guides

- **[Getting Started](https://alpacaplayhouse.com/docs/getting-started.html)** — Visual step-by-step walkthrough
- **[Full Infrastructure Guide](https://alpacaplayhouse.com/docs/alpacappsinfra.html)** — Detailed service-by-service setup reference

## License

AGPL-3.0 — see [LICENSE](LICENSE). If you modify and distribute this, you must share your changes under the same license.
