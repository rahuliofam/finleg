#!/bin/bash
# backup-finleg-to-rvault.sh — Sync Supabase DB dump + R2 buckets to RVAULT20.
#
# Runs on Alpaca Mac via weekly cron. Downloads the latest DB backup from R2
# and syncs all R2 bucket contents to local disk.
#
# Prerequisites:
#   - aws CLI (installed at /usr/local/bin/aws)
#   - RVAULT20 mounted at /Volumes/RVAULT20
#   - Environment in ~/.env-finleg
#
# Usage:
#   ./backup-finleg-to-rvault.sh              # full sync
#   ./backup-finleg-to-rvault.sh --dry-run    # show what would happen
#
# Cron example (every Sunday 5am local — after Hostinger DB backup at 3am UTC):
#   0 5 * * 0 /Users/alpaca/scripts/backup-finleg-to-rvault.sh >> /Users/alpaca/logs/finleg-backup.log 2>&1

set -uo pipefail

# ── config ───────────────────────────────────────────────────────────
# Find RVAULT20 mount (case-insensitive — macOS fskit mounts as lowercase)
if [ -d "/Volumes/RVAULT20" ]; then
  BACKUP_ROOT="/Volumes/RVAULT20/BackupsRS/finleg"
elif [ -d "/Volumes/rvault20" ]; then
  BACKUP_ROOT="/Volumes/rvault20/BackupsRS/finleg"
else
  BACKUP_ROOT=""
fi
LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"

# Load env
ENVFILE="$HOME/.env-finleg"
if [ -f "$ENVFILE" ]; then
  export $(grep -v '^#' "$ENVFILE" | grep '=' | xargs) 2>/dev/null || true
else
  echo "$LOG_PREFIX ERROR: $ENVFILE not found" >&2
  exit 1
fi

R2_ACCESS="${R2_ACCESS_KEY_ID:-}"
R2_SECRET="${R2_SECRET_ACCESS_KEY:-}"
R2_ACCOUNT="${R2_ACCOUNT_ID:-}"
R2_ENDPOINT="https://${R2_ACCOUNT}.r2.cloudflarestorage.com"
SUPABASE_URL="${SUPABASE_URL:-https://gjdvzzxsrzuorguwkaih.supabase.co}"
SUPABASE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
AWS="${AWS_CLI:-$(command -v aws)}"
START_TIME=$(date +%s)

# Buckets to sync
BUCKETS=(financial-statements bookkeeping-docs legal-docs finleg-backups)

# ── parse args ───────────────────────────────────────────────────────
DRY_RUN=false
while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown: $1" >&2; exit 1 ;;
  esac
done

# ── validate ─────────────────────────────────────────────────────────
missing=""
[ -z "$R2_ACCESS" ]  && missing="$missing R2_ACCESS_KEY_ID"
[ -z "$R2_SECRET" ]  && missing="$missing R2_SECRET_ACCESS_KEY"
[ -z "$R2_ACCOUNT" ] && missing="$missing R2_ACCOUNT_ID"
if [ -n "$missing" ]; then
  echo "$LOG_PREFIX ERROR: Missing env vars:$missing" >&2
  exit 1
fi

[ -x "$AWS" ] || { echo "$LOG_PREFIX ERROR: aws CLI not found at $AWS" >&2; exit 1; }

if [ -z "$BACKUP_ROOT" ]; then
  echo "$LOG_PREFIX ERROR: RVAULT20 not mounted" >&2
  exit 1
fi

# ── dry run ──────────────────────────────────────────────────────────
if [ "$DRY_RUN" = true ]; then
  echo "=== DRY RUN ==="
  echo "Backup root: $BACKUP_ROOT"
  echo "R2 endpoint: $R2_ENDPOINT"
  echo "Buckets: ${BUCKETS[*]}"
  echo ""
  for bucket in "${BUCKETS[@]}"; do
    echo "Would sync: s3://$bucket/ → $BACKUP_ROOT/r2/$bucket/"
  done
  echo "Would copy latest DB dump from s3://finleg-backups/db-backups/ → $BACKUP_ROOT/supabase/"
  exit 0
fi

# ── sync R2 buckets ──────────────────────────────────────────────────
echo "$LOG_PREFIX Starting finleg backup to RVAULT20"
SYNC_FAILURES=0

for bucket in "${BUCKETS[@]}"; do
  DEST="$BACKUP_ROOT/r2/$bucket"
  mkdir -p "$DEST"
  echo "$LOG_PREFIX Syncing $bucket..."

  if AWS_ACCESS_KEY_ID="$R2_ACCESS" \
     AWS_SECRET_ACCESS_KEY="$R2_SECRET" \
     $AWS s3 sync "s3://$bucket/" "$DEST/" \
       --endpoint-url "$R2_ENDPOINT" \
       --no-progress \
       --size-only; then
    COUNT=$(find "$DEST" -type f | wc -l | tr -d ' ')
    echo "$LOG_PREFIX   $bucket: $COUNT files synced"
  else
    echo "$LOG_PREFIX   WARNING: $bucket sync had errors (continuing)"
    SYNC_FAILURES=$((SYNC_FAILURES + 1))
  fi
done

# ── copy latest DB backup to supabase folder ─────────────────────────
echo "$LOG_PREFIX Downloading latest DB backup..."

LATEST_DUMP=$(AWS_ACCESS_KEY_ID="$R2_ACCESS" \
  AWS_SECRET_ACCESS_KEY="$R2_SECRET" \
  $AWS s3 ls "s3://finleg-backups/db-backups/" \
    --endpoint-url "$R2_ENDPOINT" 2>/dev/null \
  | sort -r \
  | head -1 \
  | awk '{print $4}')

if [ -n "$LATEST_DUMP" ]; then
  mkdir -p "$BACKUP_ROOT/supabase"
  AWS_ACCESS_KEY_ID="$R2_ACCESS" \
  AWS_SECRET_ACCESS_KEY="$R2_SECRET" \
  $AWS s3 cp "s3://finleg-backups/db-backups/$LATEST_DUMP" \
    "$BACKUP_ROOT/supabase/$LATEST_DUMP" \
    --endpoint-url "$R2_ENDPOINT" \
    --no-progress

  SIZE=$(du -h "$BACKUP_ROOT/supabase/$LATEST_DUMP" | cut -f1)
  echo "$LOG_PREFIX   DB backup: $LATEST_DUMP ($SIZE)"
else
  echo "$LOG_PREFIX   WARNING: No DB backups found in R2"
fi

echo "$LOG_PREFIX Backup complete."

# ── log to Supabase ──────────────────────────────────────────────────
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
STATUS="success"
[ "$SYNC_FAILURES" -gt 0 ] && STATUS="warning"

# Build file counts JSON
COUNTS_JSON="{"
for bucket in "${BUCKETS[@]}"; do
  CNT=$(find "$BACKUP_ROOT/r2/$bucket" -type f 2>/dev/null | wc -l | tr -d ' ')
  COUNTS_JSON="$COUNTS_JSON\"$bucket\":$CNT,"
done
TOTAL_SIZE=$(du -sh "$BACKUP_ROOT" 2>/dev/null | cut -f1)
COUNTS_JSON="${COUNTS_JSON}\"total_size\":\"$TOTAL_SIZE\",\"db_dump\":\"${LATEST_DUMP:-none}\",\"sync_failures\":$SYNC_FAILURES}"

if [ -n "$SUPABASE_KEY" ]; then
  curl -sf "$SUPABASE_URL/rest/v1/backup_logs" \
    -H "apikey: $SUPABASE_KEY" \
    -H "Authorization: Bearer $SUPABASE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"source\":\"alpaca-mac\",\"backup_type\":\"r2-to-rvault\",\"status\":\"$STATUS\",\"duration_seconds\":$DURATION,\"details\":$COUNTS_JSON}" \
    >/dev/null 2>&1 || echo "$LOG_PREFIX Warning: failed to log backup to Supabase"
fi
