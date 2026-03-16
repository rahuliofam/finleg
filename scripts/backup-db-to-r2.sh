#!/bin/bash
# backup-db-to-r2.sh — Dump Supabase Postgres to a compressed file and upload to R2.
#
# Designed to run on Hostinger VPS via cron (weekly) or manually.
#
# Prerequisites:
#   - pg_dump (apt install postgresql-client-16)
#   - aws CLI (for S3-compatible R2 upload)
#   - Environment variables in ~/.env-finleg or passed directly
#
# Usage:
#   ./scripts/backup-db-to-r2.sh              # full backup
#   ./scripts/backup-db-to-r2.sh --tables     # only critical tables (faster)
#   ./scripts/backup-db-to-r2.sh --dry-run    # show what would happen
#
# Cron example (every Sunday 3am UTC):
#   0 3 * * 0 /root/finleg/scripts/backup-db-to-r2.sh >> /var/log/finleg-backup.log 2>&1

set -euo pipefail

# ── config ───────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Load env from multiple locations (Hostinger or local dev)
for envfile in "$HOME/.env-finleg" "$SCRIPT_DIR/../.env" "$SCRIPT_DIR/../local.env"; do
  [ -f "$envfile" ] && export $(grep -v '^#' "$envfile" | grep '=' | xargs) 2>/dev/null || true
done

DB_URL="${SUPABASE_DB_URL:-}"
R2_ACCESS="${R2_ACCESS_KEY_ID:-}"
R2_SECRET="${R2_SECRET_ACCESS_KEY:-}"
R2_ACCOUNT="${R2_ACCOUNT_ID:-}"
R2_BUCKET="${R2_BACKUP_BUCKET:-finleg-backups}"
R2_ENDPOINT="https://${R2_ACCOUNT}.r2.cloudflarestorage.com"

# ── parse args ───────────────────────────────────────────────────────
TABLES_ONLY=false
DRY_RUN=false
while [[ $# -gt 0 ]]; do
  case $1 in
    --tables)  TABLES_ONLY=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown: $1" >&2; exit 1 ;;
  esac
done

# ── validate ─────────────────────────────────────────────────────────
missing=""
[ -z "$DB_URL" ]    && missing="$missing SUPABASE_DB_URL"
[ -z "$R2_ACCESS" ] && missing="$missing R2_ACCESS_KEY_ID"
[ -z "$R2_SECRET" ] && missing="$missing R2_SECRET_ACCESS_KEY"
[ -z "$R2_ACCOUNT" ] && missing="$missing R2_ACCOUNT_ID"
if [ -n "$missing" ]; then
  echo "ERROR: Missing env vars:$missing" >&2
  exit 1
fi

command -v pg_dump >/dev/null 2>&1 || { echo "ERROR: pg_dump not found" >&2; exit 1; }
command -v aws >/dev/null 2>&1     || { echo "ERROR: aws CLI not found (apt install awscli)" >&2; exit 1; }

# ── build pg_dump command ────────────────────────────────────────────
DATE=$(date -u +"%Y%m%d-%H%M%S")
TMPDIR="${TMPDIR:-/tmp}"
DUMP_FILE="$TMPDIR/finleg-backup-${DATE}.sql.gz"

# Critical tables to back up (add new tables here as schema grows)
CRITICAL_TABLES=(
  document_index
  qb_general_ledger
  app_users
  user_invitations
  releases
  page_display_config
  thoughts
  site_config
  feature_requests
  qb_tokens
  qb_transactions
  category_rules
  receipts
  bookkeeping_activity_log
  statement_accounts
  statement_summaries
  investment_summaries
  holdings_snapshots
)

DUMP_ARGS=("--no-owner" "--no-privileges" "--clean" "--if-exists")

if [ "$TABLES_ONLY" = true ]; then
  for t in "${CRITICAL_TABLES[@]}"; do
    DUMP_ARGS+=("-t" "public.$t")
  done
  R2_KEY="db-backups/tables-${DATE}.sql.gz"
else
  # Full schema + data
  DUMP_ARGS+=("--schema=public")
  R2_KEY="db-backups/full-${DATE}.sql.gz"
fi

# ── dry run ──────────────────────────────────────────────────────────
if [ "$DRY_RUN" = true ]; then
  echo "=== DRY RUN ==="
  echo "pg_dump ${DUMP_ARGS[*]} | gzip > $DUMP_FILE"
  echo "Upload to: s3://$R2_BUCKET/$R2_KEY"
  echo "Endpoint:  $R2_ENDPOINT"
  exit 0
fi

# ── dump ─────────────────────────────────────────────────────────────
echo "[$(date -u +%H:%M:%S)] Starting pg_dump..."
pg_dump "$DB_URL" "${DUMP_ARGS[@]}" | gzip > "$DUMP_FILE"

SIZE=$(du -h "$DUMP_FILE" | cut -f1)
echo "[$(date -u +%H:%M:%S)] Dump complete: $DUMP_FILE ($SIZE)"

# ── upload to R2 ─────────────────────────────────────────────────────
echo "[$(date -u +%H:%M:%S)] Uploading to R2: $R2_BUCKET/$R2_KEY"

AWS_ACCESS_KEY_ID="$R2_ACCESS" \
AWS_SECRET_ACCESS_KEY="$R2_SECRET" \
aws s3 cp "$DUMP_FILE" "s3://$R2_BUCKET/$R2_KEY" \
  --endpoint-url "$R2_ENDPOINT" \
  --no-progress

echo "[$(date -u +%H:%M:%S)] Upload complete."

# ── cleanup old backups (keep last 12) ───────────────────────────────
echo "[$(date -u +%H:%M:%S)] Checking for old backups to prune..."

OLD_KEYS=$(AWS_ACCESS_KEY_ID="$R2_ACCESS" \
  AWS_SECRET_ACCESS_KEY="$R2_SECRET" \
  aws s3 ls "s3://$R2_BUCKET/db-backups/" \
    --endpoint-url "$R2_ENDPOINT" 2>/dev/null \
  | sort -r \
  | tail -n +13 \
  | awk '{print $4}')

if [ -n "$OLD_KEYS" ]; then
  while IFS= read -r key; do
    [ -z "$key" ] && continue
    echo "  Pruning: db-backups/$key"
    AWS_ACCESS_KEY_ID="$R2_ACCESS" \
    AWS_SECRET_ACCESS_KEY="$R2_SECRET" \
    aws s3 rm "s3://$R2_BUCKET/db-backups/$key" \
      --endpoint-url "$R2_ENDPOINT" 2>/dev/null || true
  done <<< "$OLD_KEYS"
else
  echo "  No old backups to prune (keeping last 12)."
fi

# ── cleanup local tmp ────────────────────────────────────────────────
rm -f "$DUMP_FILE"

echo "[$(date -u +%H:%M:%S)] Backup complete: $R2_KEY"
echo "To restore: aws s3 cp s3://$R2_BUCKET/$R2_KEY - --endpoint-url $R2_ENDPOINT | gunzip | psql \$SUPABASE_DB_URL"
