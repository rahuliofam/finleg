# Email Agent — Automated Code Changes via Email

Authorized users can email `agent@finleg.net` with a prompt to trigger Claude Code changes automatically.

## How It Works

```
User emails agent@finleg.net    →  Resend inbound webhook
  with "prompt: ..."                     ↓
                                 resend-inbound-webhook (detects "prompt:")
                                         ↓
                                 agent-prompt-handler (validates sender, queues job)
                                         ↓
                                 Immediate ack email → User
                                         ↓
                                 agent_jobs table (status: pending)
                                         ↓
                                 agent-runner.sh on Alpuca (polls every 60s)
                                         ↓
                                 claude --print "<prompt>" in finleg repo
                                         ↓
                                 git commit + push (if changes made)
                                         ↓
                                 Completion email → User
```

## Authorized Senders

| Name    | Email(s) |
|---------|----------|
| Hannah  | hannah@finleg.net, hannahsonnad@gmail.com |
| Emina   | emina@finleg.net, eminachaulk@gmail.com |
| Haydn   | haydn@finleg.net, haydnsonnad@gmail.com |
| Rahul   | rahul@finleg.net, rahulioson@gmail.com |
| Jackie  | jackie@finleg.net, jackiesonnad@gmail.com |
| Kathy   | kathy@finleg.net, kathychaulk@gmail.com |

To add a sender, edit `AUTHORIZED_SENDERS` in `supabase/functions/agent-prompt-handler/index.ts`.

## Email Format

Send an email to `agent@finleg.net` with `prompt:` in the body:

```
Subject: Anything you want (becomes the commit message prefix)

prompt: Add a new section to the dashboard that shows monthly expenses by category
```

Everything after `prompt:` is sent to Claude Code as the task.

## Setup (One-Time)

### 1. Run the database migration

```bash
./scripts/run-migration.sh supabase/migrations/029_agent_jobs.sql
```

### 2. Deploy the edge function

```bash
export BW_SESSION=$(~/bin/bw-unlock)
SUPABASE_ACCESS_TOKEN=$(bw get notes "Supabase - finleg" | grep "Mgmt Token" | cut -d' ' -f4) \
  npx supabase functions deploy agent-prompt-handler --no-verify-jwt --project-ref gjdvzzxsrzuorguwkaih
```

Also redeploy the inbound webhook (which now routes prompt emails):

```bash
SUPABASE_ACCESS_TOKEN=$(bw get notes "Supabase - finleg" | grep "Mgmt Token" | cut -d' ' -f4) \
  npx supabase functions deploy resend-inbound-webhook --no-verify-jwt --project-ref gjdvzzxsrzuorguwkaih
```

### 3. Set up Alpuca

SSH into Alpuca and clone/pull the repo:

```bash
ssh paca@100.74.59.97

# Clone if not already there
git clone https://github.com/YOUR_USERNAME/finleg.git ~/finleg
# Or pull latest
cd ~/finleg && git pull

# Create environment file
cat > ~/.env-finleg << 'EOF'
SUPABASE_URL=https://gjdvzzxsrzuorguwkaih.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<from .env>
RESEND_API_KEY=<from Supabase secrets or Bitwarden>
EOF

# Ensure Claude CLI is installed
npm i -g @anthropic-ai/claude-code

# Ensure jq is installed
brew install jq

# Test the runner
./scripts/agent-runner.sh --once
```

### 4. Install the launchd agent

```bash
# On Alpuca:
mkdir -p ~/.finleg-agent
cp ~/finleg/scripts/com.finleg.agent-runner.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.finleg.agent-runner.plist
```

### 5. Verify

```bash
# Check it's running
launchctl list | grep finleg

# Check logs
tail -f ~/.finleg-agent/runner.log
```

## Monitoring

- **Job queue**: Check `agent_jobs` table in Supabase dashboard
- **Runner logs**: `~/.finleg-agent/runner.log` and `runner-error.log` on Alpuca
- **Individual job logs**: `~/.finleg-agent/job-<uuid>.log` on Alpuca

## Troubleshooting

| Issue | Fix |
|-------|-----|
| No ack email | Check `agent-prompt-handler` logs in Supabase dashboard |
| Job stuck as pending | Check runner is running: `launchctl list \| grep finleg` |
| Job stuck as running | Check `~/.finleg-agent/job-<id>.log` on Alpuca |
| Claude CLI fails | Ensure `ANTHROPIC_API_KEY` is set in Alpuca's shell profile |
| Git push fails | Ensure Alpuca has git credentials configured |

## Security

- Only emails from the authorized sender list are processed
- The runner uses the service role key (server-side only, never exposed to browsers)
- Jobs are processed sequentially with a file lock to prevent concurrent runs
- Claude CLI runs with restricted tools: Edit, Write, Read, Glob, Grep, Bash
