#!/bin/bash
# agent-runner.sh — Polls Supabase for pending agent_jobs, runs Claude Code CLI,
# and emails results back via Resend.
#
# Designed to run on Alpuca (Mac mini M4) via launchd every 60 seconds.
#
# Prerequisites:
#   - Claude CLI: npm i -g @anthropic-ai/claude-code
#   - jq: brew install jq
#   - Environment: ~/.env-finleg with SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY
#   - Finleg repo cloned at ~/finleg (or set FINLEG_REPO_DIR)
#
# Usage:
#   ./scripts/agent-runner.sh          # Poll once and process pending jobs
#   ./scripts/agent-runner.sh --once   # Same (default)
#   ./scripts/agent-runner.sh --loop   # Poll continuously every 60s (for testing)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FINLEG_REPO_DIR="${FINLEG_REPO_DIR:-$HOME/finleg}"
LOCK_FILE="/tmp/finleg-agent-runner.lock"
LOG_DIR="$HOME/.finleg-agent"
mkdir -p "$LOG_DIR"

# ── Load environment ─────────────────────────────────────────────────
for envfile in "$HOME/.env-finleg" "$FINLEG_REPO_DIR/.env" "$FINLEG_REPO_DIR/local.env"; do
  if [ -f "$envfile" ]; then
    export $(grep -v '^#' "$envfile" | grep '=' | xargs) 2>/dev/null || true
  fi
done

SUPABASE_URL="${SUPABASE_URL:-https://gjdvzzxsrzuorguwkaih.supabase.co}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:?Missing SUPABASE_SERVICE_ROLE_KEY}"
RESEND_API_KEY="${RESEND_API_KEY:?Missing RESEND_API_KEY}"

# ── Lock to prevent concurrent runs ─────────────────────────────────
cleanup() { rm -f "$LOCK_FILE"; }
trap cleanup EXIT

if [ -f "$LOCK_FILE" ]; then
  LOCK_PID=$(cat "$LOCK_FILE" 2>/dev/null || echo "")
  if [ -n "$LOCK_PID" ] && kill -0 "$LOCK_PID" 2>/dev/null; then
    echo "Agent runner already running (PID $LOCK_PID), skipping."
    exit 0
  fi
  echo "Stale lock file found, removing."
  rm -f "$LOCK_FILE"
fi
echo $$ > "$LOCK_FILE"

# ── Supabase REST helpers ────────────────────────────────────────────
sb_api() {
  local method="$1" endpoint="$2" body="${3:-}"
  local url="${SUPABASE_URL}/rest/v1/${endpoint}"
  local args=(
    -s -S
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}"
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
    -H "Content-Type: application/json"
    -H "Prefer: return=representation"
  )
  if [ "$method" = "GET" ]; then
    curl "${args[@]}" "$url"
  else
    curl "${args[@]}" -X "$method" -d "$body" "$url"
  fi
}

# ── Send email via Resend ────────────────────────────────────────────
send_email() {
  local to="$1" subject="$2" html="$3" text="$4"
  curl -s -S -X POST "https://api.resend.com/emails" \
    -H "Authorization: Bearer ${RESEND_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "$(jq -n \
      --arg from "Finleg Agent <agent@finleg.net>" \
      --arg to "$to" \
      --arg reply_to "agent@finleg.net" \
      --arg subject "$subject" \
      --arg html "$html" \
      --arg text "$text" \
      '{from: $from, to: [$to], reply_to: $reply_to, subject: $subject, html: $html, text: $text}'
    )"
}

# ── HTML email builder ───────────────────────────────────────────────
build_result_email() {
  local sender_name="$1" prompt="$2" result="$3" success="$4"
  local status_icon status_text status_color bg_color

  if [ "$success" = "true" ]; then
    status_icon="✅"
    status_text="Completed Successfully"
    status_color="#16a34a"
    bg_color="#f0fdf4"
  else
    status_icon="❌"
    status_text="Failed"
    status_color="#dc2626"
    bg_color="#fef2f2"
  fi

  # Truncate for email display
  local display_prompt="${prompt:0:500}"
  local display_result="${result:0:5000}"

  # Escape HTML
  display_prompt=$(echo "$display_prompt" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g')
  display_result=$(echo "$display_result" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g')

  cat <<HTMLEOF
<div style="max-width:600px;margin:0 auto;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#334155 100%);padding:32px;text-align:center;">
    <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">${status_icon} Agent ${status_text}</h1>
    <p style="margin:8px 0 0;color:#94a3b8;font-size:14px;">Finleg Code Agent</p>
  </div>
  <div style="padding:24px 32px;">
    <p style="color:#334155;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${sender_name},</p>
    <p style="color:#334155;font-size:15px;line-height:1.6;margin:0 0 8px;"><strong>Your request:</strong></p>
    <div style="background:#f1f5f9;border-left:4px solid #94a3b8;padding:12px;border-radius:0 8px 8px 0;margin:0 0 16px;">
      <code style="color:#475569;font-size:13px;white-space:pre-wrap;">${display_prompt}</code>
    </div>
    <p style="color:#334155;font-size:15px;line-height:1.6;margin:0 0 8px;"><strong>Result:</strong></p>
    <div style="background:${bg_color};border-left:4px solid ${status_color};padding:12px;border-radius:0 8px 8px 0;margin:0 0 16px;">
      <pre style="color:#1e293b;font-size:13px;white-space:pre-wrap;margin:0;font-family:'Courier New',monospace;">${display_result}</pre>
    </div>
  </div>
  <div style="background:#f8fafc;padding:16px 32px;text-align:center;border-top:1px solid #e2e8f0;">
    <p style="margin:0;color:#94a3b8;font-size:12px;">Finleg Agent &bull; Automated Code Changes</p>
  </div>
</div>
HTMLEOF
}

# ── Process a single job ─────────────────────────────────────────────
process_job() {
  local job_id="$1" sender_email="$2" sender_name="$3" prompt="$4" subject="$5"

  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Processing job $job_id from $sender_name ($sender_email)"

  # Mark as running
  sb_api PATCH "agent_jobs?id=eq.${job_id}" \
    "{\"status\": \"running\", \"started_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > /dev/null

  # Run Claude Code CLI in the finleg repo
  local output_file="${LOG_DIR}/job-${job_id}.log"
  local success="false"
  local result=""

  if cd "$FINLEG_REPO_DIR" 2>/dev/null; then
    # Pull latest before making changes
    git pull --ff-only origin main 2>/dev/null || true

    # Run claude with --print (headless mode) with a timeout of 10 minutes
    if timeout 600 claude --print \
      --allowedTools "Edit,Write,Read,Glob,Grep,Bash" \
      "$prompt" \
      > "$output_file" 2>&1; then
      success="true"
      result=$(cat "$output_file")
    else
      result=$(cat "$output_file" 2>/dev/null || echo "Claude CLI execution failed or timed out")
    fi

    # If Claude made changes, commit and push
    if [ -n "$(git status --porcelain)" ]; then
      git add -A
      git commit -m "$(cat <<EOF
agent: ${subject:-email prompt from $sender_name}

Prompt: ${prompt:0:200}
Job: $job_id

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)" 2>/dev/null || true
      git push origin main 2>/dev/null || true
      result="${result}

---
Changes were committed and pushed to main."
    else
      result="${result}

---
No file changes were made."
    fi
  else
    result="ERROR: Could not access finleg repo at $FINLEG_REPO_DIR"
  fi

  # Update job in database
  local completed_at
  completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  if [ "$success" = "true" ]; then
    sb_api PATCH "agent_jobs?id=eq.${job_id}" \
      "$(jq -n --arg r "$result" --arg t "$completed_at" \
        '{status: "completed", result: $r, completed_at: $t}')" > /dev/null
  else
    sb_api PATCH "agent_jobs?id=eq.${job_id}" \
      "$(jq -n --arg r "$result" --arg e "$result" --arg t "$completed_at" \
        '{status: "failed", result: $r, error: $e, completed_at: $t}')" > /dev/null
  fi

  # Send completion email
  local email_subject
  if [ "$success" = "true" ]; then
    email_subject="✅ Agent completed: ${subject:-your request}"
  else
    email_subject="❌ Agent failed: ${subject:-your request}"
  fi

  local html_body
  html_body=$(build_result_email "$sender_name" "$prompt" "$result" "$success")
  local text_body="Hi ${sender_name},\n\nYour request: ${prompt:0:300}\n\nResult:\n${result:0:3000}\n\n— Finleg Agent"

  send_email "$sender_email" "$email_subject" "$html_body" "$text_body" > /dev/null 2>&1 || \
    echo "WARNING: Failed to send completion email to $sender_email"

  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Job $job_id ${success} (${#result} chars output)"
}

# ── Main: poll for pending jobs ──────────────────────────────────────
poll_and_process() {
  # Fetch pending jobs (oldest first, limit 1 to process sequentially)
  local jobs
  jobs=$(sb_api GET "agent_jobs?status=eq.pending&order=created_at.asc&limit=1")

  # Check if we got any jobs
  if [ -z "$jobs" ] || [ "$jobs" = "[]" ]; then
    return 0
  fi

  # Parse job fields
  local job_id sender_email sender_name prompt subject
  job_id=$(echo "$jobs" | jq -r '.[0].id')
  sender_email=$(echo "$jobs" | jq -r '.[0].sender_email')
  sender_name=$(echo "$jobs" | jq -r '.[0].sender_name // "User"')
  prompt=$(echo "$jobs" | jq -r '.[0].prompt')
  subject=$(echo "$jobs" | jq -r '.[0].subject // ""')

  if [ "$job_id" = "null" ] || [ -z "$job_id" ]; then
    return 0
  fi

  process_job "$job_id" "$sender_email" "$sender_name" "$prompt" "$subject"
}

# ── Entry point ──────────────────────────────────────────────────────
MODE="${1:---once}"

case "$MODE" in
  --loop)
    echo "Agent runner starting in loop mode (polling every 60s)..."
    while true; do
      poll_and_process || true
      sleep 60
    done
    ;;
  --once|*)
    poll_and_process
    ;;
esac
