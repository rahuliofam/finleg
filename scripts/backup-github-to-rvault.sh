#!/bin/bash
# backup-github-to-rvault.sh — Mirror GitHub repos to RVAULT20.
#
# Creates bare mirror clones of all finleg-related GitHub repos on RVAULT20.
# Each run does a fresh fetch (incremental) into existing mirrors.
#
# Runs on Alpaca Mac via cron (weekly, Sundays 5:30 AM local).
#
# Prerequisites:
#   - git CLI with GitHub SSH access (ssh key in agent)
#   - RVAULT20 mounted
#   - Environment in ~/.env-finleg
#
# Usage:
#   ./backup-github-to-rvault.sh              # full mirror
#   ./backup-github-to-rvault.sh --dry-run    # show what would happen
#
# Cron example (Sundays 5:30am local):
#   30 5 * * 0 PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin /Users/alpuca/scripts/backup-github-to-rvault.sh >> /Users/alpuca/logs/github-backup.log 2>&1

set -uo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')] [github-backup]"

# Load env
ENVFILE="$HOME/.env-finleg"
if [ -f "$ENVFILE" ]; then
  export $(grep -v '^#' "$ENVFILE" | grep '=' | xargs) 2>/dev/null || true
fi

SUPABASE_URL="${SUPABASE_URL:-https://gjdvzzxsrzuorguwkaih.supabase.co}"
SUPABASE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
START_TIME=$(date +%s)

# GitHub repos to mirror (org/repo format)
REPOS=(
  rahuliofam/finleg
)

# Find RVAULT20 mount
if [ -d "/Volumes/RVAULT20" ]; then
  BACKUP_ROOT="/Volumes/RVAULT20/BackupsRS/finleg/github"
elif [ -d "/Volumes/rvault20" ]; then
  BACKUP_ROOT="/Volumes/rvault20/BackupsRS/finleg/github"
else
  echo "$LOG_PREFIX ERROR: RVAULT20 not mounted" >&2
  exit 1
fi

# ── parse args ───────────────────────────────────────────────────────
DRY_RUN=false
while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown: $1" >&2; exit 1 ;;
  esac
done

# ── dry run ──────────────────────────────────────────────────────────
if [ "$DRY_RUN" = true ]; then
  echo "=== DRY RUN ==="
  echo "Backup root: $BACKUP_ROOT"
  for repo in "${REPOS[@]}"; do
    REPO_NAME=$(echo "$repo" | tr '/' '-')
    echo "Would mirror: https://github.com/$repo → $BACKUP_ROOT/$REPO_NAME.git"
  done
  exit 0
fi

# ── mirror repos ────────────────────────────────────────────────────
mkdir -p "$BACKUP_ROOT"
FAILURES=0
TOTAL_SIZE=""

echo "$LOG_PREFIX Starting GitHub backup to RVAULT20"

for repo in "${REPOS[@]}"; do
  REPO_NAME=$(echo "$repo" | tr '/' '-')
  DEST="$BACKUP_ROOT/$REPO_NAME.git"

  if [ -d "$DEST" ]; then
    # Update existing mirror
    echo "$LOG_PREFIX Fetching updates for $repo..."
    if git -C "$DEST" fetch --all --prune 2>&1; then
      SIZE=$(du -sh "$DEST" | cut -f1)
      echo "$LOG_PREFIX   $repo: updated ($SIZE)"
    else
      echo "$LOG_PREFIX   WARNING: $repo fetch failed"
      FAILURES=$((FAILURES + 1))
    fi
  else
    # Initial bare clone
    echo "$LOG_PREFIX Cloning mirror of $repo..."
    if git clone --mirror "https://github.com/$repo.git" "$DEST" 2>&1; then
      SIZE=$(du -sh "$DEST" | cut -f1)
      echo "$LOG_PREFIX   $repo: cloned ($SIZE)"
    else
      echo "$LOG_PREFIX   WARNING: $repo clone failed"
      FAILURES=$((FAILURES + 1))
    fi
  fi
done

TOTAL_SIZE=$(du -sh "$BACKUP_ROOT" 2>/dev/null | cut -f1)
echo "$LOG_PREFIX GitHub backup complete. Total: $TOTAL_SIZE"

# ── log to Supabase ──────────────────────────────────────────────────
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
STATUS="success"
[ "$FAILURES" -gt 0 ] && STATUS="warning"

if [ -n "$SUPABASE_KEY" ]; then
  REPO_COUNT=${#REPOS[@]}
  curl -sf "$SUPABASE_URL/rest/v1/backup_logs" \
    -H "apikey: $SUPABASE_KEY" \
    -H "Authorization: Bearer $SUPABASE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"source\":\"alpaca-mac\",\"backup_type\":\"github-to-rvault\",\"status\":\"$STATUS\",\"duration_seconds\":$DURATION,\"details\":{\"repos\":$REPO_COUNT,\"total_size\":\"$TOTAL_SIZE\",\"failures\":$FAILURES}}" \
    >/dev/null 2>&1 || echo "$LOG_PREFIX Warning: failed to log to Supabase"
fi
