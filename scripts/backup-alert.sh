#!/bin/bash
# backup-alert.sh — Check backup freshness and alert on failures.
#
# Queries the backup_logs table in Supabase. If any backup type hasn't
# succeeded in the expected window, sends an alert email via Resend.
#
# Runs on Alpaca Mac via cron (daily at 8am local).
#
# Prerequisites:
#   - curl, jq (or python3)
#   - Environment in ~/.env-finleg (SUPABASE keys + RESEND_API_KEY)
#
# Usage:
#   ./backup-alert.sh              # check and alert if needed
#   ./backup-alert.sh --dry-run    # show status without emailing
#
# Cron example (daily 8am local):
#   0 8 * * * PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin /Users/alpuca/scripts/backup-alert.sh >> /Users/alpuca/logs/backup-alert.log 2>&1

set -uo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')] [backup-alert]"

# Load env
ENVFILE="$HOME/.env-finleg"
if [ -f "$ENVFILE" ]; then
  export $(grep -v '^#' "$ENVFILE" | grep '=' | xargs) 2>/dev/null || true
fi

SUPABASE_URL="${SUPABASE_URL:-https://gjdvzzxsrzuorguwkaih.supabase.co}"
SUPABASE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
RESEND_KEY="${RESEND_API_KEY:-}"
ALERT_EMAIL="${ADMIN_EMAIL:-rahul@finleg.net}"

# ── parse args ───────────────────────────────────────────────────────
DRY_RUN=false
while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown: $1" >&2; exit 1 ;;
  esac
done

# ── validate ─────────────────────────────────────────────────────────
if [ -z "$SUPABASE_KEY" ]; then
  echo "$LOG_PREFIX ERROR: SUPABASE_SERVICE_ROLE_KEY not set" >&2
  exit 1
fi

# ── check backup freshness ──────────────────────────────────────────
echo "$LOG_PREFIX Checking backup freshness..."

# Define expected backup types and their max age in days
# db-to-r2: weekly (max 9 days to allow for slight drift)
# r2-to-rvault: weekly (max 9 days)
# d1-to-rvault: monthly (max 35 days)

ALERTS=""
STATUSES=""

check_backup() {
  local BACKUP_TYPE="$1"
  local MAX_AGE_DAYS="$2"
  local LABEL="$3"

  # Get most recent successful backup of this type
  RESPONSE=$(curl -sf "$SUPABASE_URL/rest/v1/backup_logs?backup_type=eq.$BACKUP_TYPE&status=eq.success&order=created_at.desc&limit=1" \
    -H "apikey: $SUPABASE_KEY" \
    -H "Authorization: Bearer $SUPABASE_KEY" \
    2>&1)

  LAST_DATE=$(echo "$RESPONSE" | python3 -c "
import sys, json
from datetime import datetime, timezone
data = json.load(sys.stdin)
if data:
    print(data[0].get('created_at',''))
else:
    print('')
" 2>/dev/null)

  if [ -z "$LAST_DATE" ]; then
    ALERTS="$ALERTS\n⚠️ $LABEL: NEVER RUN (no successful backup found)"
    STATUSES="$STATUSES\n❌ $LABEL: never"
    return
  fi

  # Calculate age in days
  AGE_DAYS=$(python3 -c "
from datetime import datetime, timezone
last = datetime.fromisoformat('$LAST_DATE'.replace('Z','+00:00'))
now = datetime.now(timezone.utc)
print((now - last).days)
" 2>/dev/null)

  if [ "$AGE_DAYS" -gt "$MAX_AGE_DAYS" ]; then
    ALERTS="$ALERTS\n⚠️ $LABEL: last success was ${AGE_DAYS} days ago (max: ${MAX_AGE_DAYS}d) — $LAST_DATE"
    STATUSES="$STATUSES\n❌ $LABEL: ${AGE_DAYS}d ago (OVERDUE)"
  else
    STATUSES="$STATUSES\n✅ $LABEL: ${AGE_DAYS}d ago"
  fi
}

check_backup "db-to-r2"      9  "Database → R2 (Hostinger)"
check_backup "r2-to-rvault"  9  "R2 → RVAULT20 (Alpaca Mac)"
check_backup "d1-to-rvault"  35 "D1 Sessions → RVAULT20"

# Also check if RVAULT20 is mounted
if [ -d "/Volumes/RVAULT20" ] || [ -d "/Volumes/rvault20" ]; then
  STATUSES="$STATUSES\n✅ RVAULT20: mounted"
else
  ALERTS="$ALERTS\n⚠️ RVAULT20: NOT MOUNTED — backups to external drive will fail"
  STATUSES="$STATUSES\n❌ RVAULT20: not mounted"
fi

# ── report ───────────────────────────────────────────────────────────
echo "$LOG_PREFIX Status:"
echo -e "$STATUSES"

if [ "$DRY_RUN" = true ]; then
  echo ""
  echo "=== DRY RUN ==="
  if [ -n "$ALERTS" ]; then
    echo "Would send alert email with:"
    echo -e "$ALERTS"
  else
    echo "All backups healthy — no alert needed."
  fi
  exit 0
fi

# ── send alert if needed ────────────────────────────────────────────
if [ -z "$ALERTS" ]; then
  echo "$LOG_PREFIX All backups healthy — no alert needed."
  exit 0
fi

if [ -z "$RESEND_KEY" ]; then
  echo "$LOG_PREFIX WARNING: Alerts detected but RESEND_API_KEY not set — cannot email" >&2
  echo -e "$ALERTS"
  exit 1
fi

echo "$LOG_PREFIX Sending alert email..."

# Build email body and send via curl + python3 for JSON construction
HOSTNAME_STR=$(hostname)
EMAIL_JSON=$(python3 -c "
import json, os
alerts = '''$(echo -e "$ALERTS")'''
statuses = '''$(echo -e "$STATUSES")'''
body = '<h2>Finleg Backup Alert</h2>'
body += '<p>One or more backups are overdue or missing:</p>'
body += '<pre style=\"background:#f5f5f5;padding:12px;border-radius:4px;\">' + alerts + '</pre>'
body += '<h3>Full Status</h3>'
body += '<pre style=\"background:#f5f5f5;padding:12px;border-radius:4px;\">' + statuses + '</pre>'
body += '<p><b>Action needed:</b> SSH into the relevant machine and check logs.</p>'
body += '<p style=\"color:#888;font-size:12px;\">Sent by backup-alert.sh on $HOSTNAME_STR</p>'
print(json.dumps({
    'from': 'Finleg Backups <alerts@alpacaplayhouse.com>',
    'to': ['$ALERT_EMAIL'],
    'subject': 'Finleg Backup Alert - overdue backups detected',
    'html': body
}))
")

curl -sf "https://api.resend.com/emails" \
  -H "Authorization: Bearer $RESEND_KEY" \
  -H "Content-Type: application/json" \
  -d "$EMAIL_JSON" >/dev/null 2>&1

if [ $? -eq 0 ]; then
  echo "$LOG_PREFIX Alert email sent to $ALERT_EMAIL"
else
  echo "$LOG_PREFIX WARNING: Failed to send alert email" >&2
fi
