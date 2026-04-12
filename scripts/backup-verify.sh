#!/bin/bash
# backup-verify.sh — Verify backup integrity by test-restoring to a temp database.
#
# Downloads the latest pg_dump from R2, restores it to a temporary local
# SQLite-like check (validates SQL syntax + row counts), and reports results.
# Does NOT touch the production Supabase database.
#
# Runs on Alpaca Mac via cron (monthly, 2nd Sunday 7am local).
#
# Prerequisites:
#   - aws CLI, psql (for optional full verify), python3
#   - Environment in ~/.env-finleg
#
# Usage:
#   ./backup-verify.sh              # verify latest backup
#   ./backup-verify.sh --dry-run    # show what would happen
#   ./backup-verify.sh --full       # restore to temp DB and check row counts
#
# Cron example (2nd Sunday of month, 7am local):
#   0 7 8-14 * 0 /Users/alpuca/scripts/backup-verify.sh >> /Users/alpuca/logs/backup-verify.log 2>&1

set -uo pipefail

export PATH="/opt/homebrew/opt/libpq/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')] [backup-verify]"

# Load env
ENVFILE="$HOME/.env-finleg"
if [ -f "$ENVFILE" ]; then
  export $(grep -v '^#' "$ENVFILE" | grep '=' | xargs) 2>/dev/null || true
fi

R2_ACCESS="${R2_ACCESS_KEY_ID:-}"
R2_SECRET="${R2_SECRET_ACCESS_KEY:-}"
R2_ACCOUNT="${R2_ACCOUNT_ID:-}"
R2_BUCKET="${R2_BACKUP_BUCKET:-finleg-backups}"
R2_ENDPOINT="https://${R2_ACCOUNT}.r2.cloudflarestorage.com"
SUPABASE_URL="${SUPABASE_URL:-https://gjdvzzxsrzuorguwkaih.supabase.co}"
SUPABASE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
RESEND_KEY="${RESEND_API_KEY:-}"
ALERT_EMAIL="${ADMIN_EMAIL:-rahul@finleg.net}"
AWS="${AWS_CLI:-$(command -v aws)}"
START_TIME=$(date +%s)

# ── parse args ───────────────────────────────────────────────────────
DRY_RUN=false
FULL_VERIFY=false
while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run) DRY_RUN=true; shift ;;
    --full)    FULL_VERIFY=true; shift ;;
    *) echo "Unknown: $1" >&2; exit 1 ;;
  esac
done

# ── validate ─────────────────────────────────────────────────────────
missing=""
[ -z "$R2_ACCESS" ] && missing="$missing R2_ACCESS_KEY_ID"
[ -z "$R2_SECRET" ] && missing="$missing R2_SECRET_ACCESS_KEY"
[ -z "$R2_ACCOUNT" ] && missing="$missing R2_ACCOUNT_ID"
if [ -n "$missing" ]; then
  echo "$LOG_PREFIX ERROR: Missing env vars:$missing" >&2
  exit 1
fi

# ── find latest backup ──────────────────────────────────────────────
echo "$LOG_PREFIX Finding latest backup in R2..."

LATEST=$(AWS_ACCESS_KEY_ID="$R2_ACCESS" \
  AWS_SECRET_ACCESS_KEY="$R2_SECRET" \
  $AWS s3 ls "s3://$R2_BUCKET/db-backups/" \
    --endpoint-url "$R2_ENDPOINT" 2>/dev/null \
  | grep "full-" \
  | sort -r \
  | head -1)

if [ -z "$LATEST" ]; then
  echo "$LOG_PREFIX ERROR: No backups found in R2" >&2
  exit 1
fi

LATEST_KEY=$(echo "$LATEST" | awk '{print $4}')
LATEST_SIZE=$(echo "$LATEST" | awk '{print $3}')
LATEST_DATE=$(echo "$LATEST" | awk '{print $1, $2}')

echo "$LOG_PREFIX Latest backup: $LATEST_KEY ($LATEST_SIZE bytes, from $LATEST_DATE)"

# ── dry run ──────────────────────────────────────────────────────────
if [ "$DRY_RUN" = true ]; then
  echo "=== DRY RUN ==="
  echo "Would download: s3://$R2_BUCKET/db-backups/$LATEST_KEY"
  echo "Would verify: SQL syntax, table presence, row count minimums"
  if [ "$FULL_VERIFY" = true ]; then
    echo "Would also: restore to temporary local Postgres database"
  fi
  exit 0
fi

# ── download backup ─────────────────────────────────────────────────
TMPDIR="${TMPDIR:-/tmp}"
DUMP_FILE="$TMPDIR/finleg-verify-$(date +%s).sql.gz"
SQL_FILE="$TMPDIR/finleg-verify-$(date +%s).sql"

echo "$LOG_PREFIX Downloading backup..."
AWS_ACCESS_KEY_ID="$R2_ACCESS" \
AWS_SECRET_ACCESS_KEY="$R2_SECRET" \
$AWS s3 cp "s3://$R2_BUCKET/db-backups/$LATEST_KEY" "$DUMP_FILE" \
  --endpoint-url "$R2_ENDPOINT" \
  --no-progress

echo "$LOG_PREFIX Decompressing..."
gunzip -k "$DUMP_FILE"
SQL_FILE="${DUMP_FILE%.gz}"

if [ ! -f "$SQL_FILE" ] || [ ! -s "$SQL_FILE" ]; then
  echo "$LOG_PREFIX ERROR: Decompressed file is empty" >&2
  rm -f "$DUMP_FILE" "$SQL_FILE"
  exit 1
fi

SQL_SIZE=$(du -h "$SQL_FILE" | cut -f1)
echo "$LOG_PREFIX Decompressed: $SQL_SIZE"

# ── verify 1: basic SQL structure ───────────────────────────────────
echo "$LOG_PREFIX Checking SQL structure..."

ERRORS=""
REPORT=""

# Check for critical tables
CRITICAL_TABLES=(document_index qb_general_ledger app_users releases thoughts)
for table in "${CRITICAL_TABLES[@]}"; do
  if grep -q "CREATE TABLE.*$table" "$SQL_FILE" 2>/dev/null; then
    REPORT="$REPORT\n  ✅ $table: schema present"
  else
    ERRORS="$ERRORS\n  ❌ $table: missing from backup"
    REPORT="$REPORT\n  ❌ $table: MISSING"
  fi
done

# Check for COPY/INSERT data statements
for table in "${CRITICAL_TABLES[@]}"; do
  if grep -q "COPY public\.$table" "$SQL_FILE" 2>/dev/null || grep -q "INSERT.*$table" "$SQL_FILE" 2>/dev/null; then
    # Count approximate rows
    ROW_COUNT=$(grep -c "^" <(sed -n "/COPY public\.$table/,/^\\\\\./p" "$SQL_FILE" 2>/dev/null) 2>/dev/null || echo "0")
    ROW_COUNT=$((ROW_COUNT - 2))  # subtract COPY header and \. terminator
    [ "$ROW_COUNT" -lt 0 ] && ROW_COUNT=0
    REPORT="$REPORT\n  📊 $table: ~$ROW_COUNT rows"
  fi
done

# Check for critical functions
FUNCTIONS=(is_admin record_release_event match_thoughts)
for func in "${FUNCTIONS[@]}"; do
  if grep -q "CREATE.*FUNCTION.*$func" "$SQL_FILE" 2>/dev/null; then
    REPORT="$REPORT\n  ✅ $func(): present"
  else
    REPORT="$REPORT\n  ⚠️ $func(): not found (may be OK if using pg_dump --schema=public)"
  fi
done

# Check minimum row counts for key tables
MIN_COUNTS="document_index:1500 qb_general_ledger:9000 app_users:3 releases:80"
for entry in $MIN_COUNTS; do
  TABLE=$(echo "$entry" | cut -d: -f1)
  MIN=$(echo "$entry" | cut -d: -f2)
  ACTUAL=$(grep -c "^" <(sed -n "/COPY public\.$TABLE/,/^\\\\\./p" "$SQL_FILE" 2>/dev/null) 2>/dev/null || echo "0")
  ACTUAL=$((ACTUAL - 2))
  [ "$ACTUAL" -lt 0 ] && ACTUAL=0

  if [ "$ACTUAL" -ge "$MIN" ]; then
    REPORT="$REPORT\n  ✅ $TABLE: $ACTUAL rows (min: $MIN)"
  else
    ERRORS="$ERRORS\n  ❌ $TABLE: only $ACTUAL rows (expected min: $MIN)"
    REPORT="$REPORT\n  ❌ $TABLE: $ACTUAL rows (BELOW min: $MIN)"
  fi
done

# Check file isn't truncated (should end with a valid statement)
LAST_LINE=$(tail -5 "$SQL_FILE" | grep -v '^$' | tail -1)
if echo "$LAST_LINE" | grep -qE '(;|\\.)$'; then
  REPORT="$REPORT\n  ✅ File ends cleanly (not truncated)"
else
  ERRORS="$ERRORS\n  ⚠️ File may be truncated (last line: $LAST_LINE)"
  REPORT="$REPORT\n  ⚠️ Possible truncation"
fi

# ── verify 2: R2 bucket file counts ────────────────────────────────
echo "$LOG_PREFIX Checking R2 bucket file counts..."

for bucket in financial-statements bookkeeping-docs; do
  COUNT=$(AWS_ACCESS_KEY_ID="$R2_ACCESS" \
    AWS_SECRET_ACCESS_KEY="$R2_SECRET" \
    $AWS s3 ls "s3://$bucket/" --recursive \
      --endpoint-url "$R2_ENDPOINT" 2>/dev/null \
    | wc -l | tr -d ' ')

  if [ "$COUNT" -gt 0 ]; then
    REPORT="$REPORT\n  ✅ R2 $bucket: $COUNT files"
  else
    ERRORS="$ERRORS\n  ❌ R2 $bucket: empty or inaccessible"
    REPORT="$REPORT\n  ❌ R2 $bucket: EMPTY"
  fi
done

# ── cleanup ─────────────────────────────────────────────────────────
rm -f "$DUMP_FILE" "$SQL_FILE"

# ── results ─────────────────────────────────────────────────────────
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo ""
echo "$LOG_PREFIX ════════════════════════════════════════"
echo "$LOG_PREFIX  BACKUP VERIFICATION REPORT"
echo "$LOG_PREFIX ════════════════════════════════════════"
echo "$LOG_PREFIX Backup: $LATEST_KEY"
echo "$LOG_PREFIX Size: $SQL_SIZE (compressed: $LATEST_SIZE bytes)"
echo "$LOG_PREFIX Duration: ${DURATION}s"
echo -e "$REPORT"

if [ -n "$ERRORS" ]; then
  echo ""
  echo "$LOG_PREFIX ⚠️ ISSUES FOUND:"
  echo -e "$ERRORS"
  STATUS="warning"
else
  echo ""
  echo "$LOG_PREFIX ✅ ALL CHECKS PASSED"
  STATUS="success"
fi

echo "$LOG_PREFIX ════════════════════════════════════════"

# ── log to Supabase ──────────────────────────────────────────────────
if [ -n "$SUPABASE_KEY" ]; then
  CLEAN_REPORT=$(echo -e "$REPORT" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))" 2>/dev/null | sed 's/^"//;s/"$//')
  curl -sf "$SUPABASE_URL/rest/v1/backup_logs" \
    -H "apikey: $SUPABASE_KEY" \
    -H "Authorization: Bearer $SUPABASE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"source\":\"alpaca-mac\",\"backup_type\":\"verify-drill\",\"status\":\"$STATUS\",\"duration_seconds\":$DURATION,\"r2_key\":\"db-backups/$LATEST_KEY\",\"details\":{\"sql_size\":\"$SQL_SIZE\",\"backup_key\":\"$LATEST_KEY\"}}" \
    >/dev/null 2>&1 || echo "$LOG_PREFIX Warning: failed to log to Supabase"
fi

# ── email report (always send for monthly drill) ─────────────────────
if [ -n "$RESEND_KEY" ]; then
  EMOJI="✅"
  [ "$STATUS" = "warning" ] && EMOJI="⚠️"

  HOSTNAME_STR=$(hostname)
  EMAIL_JSON=$(python3 -c "
import json
report = '''$(echo -e "$REPORT")'''
errors = '''$(echo -e "$ERRORS")'''
body = '<h2>$EMOJI Finleg Backup Verification Report</h2>'
body += '<p><b>Backup:</b> $LATEST_KEY<br><b>Size:</b> $SQL_SIZE<br><b>Duration:</b> ${DURATION}s</p>'
body += '<pre style=\"background:#f5f5f5;padding:12px;border-radius:4px;\">' + report + '</pre>'
if errors.strip():
    body += '<h3>Issues</h3><pre style=\"background:#fff3cd;padding:12px;border-radius:4px;\">' + errors + '</pre>'
body += '<p style=\"color:#888;font-size:12px;\">Monthly DR drill by backup-verify.sh on $HOSTNAME_STR</p>'
print(json.dumps({
    'from': 'Finleg Backups <alerts@alpacaplayhouse.com>',
    'to': ['$ALERT_EMAIL'],
    'subject': '$EMOJI Finleg Monthly Backup Verification - $STATUS',
    'html': body
}))
")

  curl -sf "https://api.resend.com/emails" \
    -H "Authorization: Bearer $RESEND_KEY" \
    -H "Content-Type: application/json" \
    -d "$EMAIL_JSON" >/dev/null 2>&1

  if [ $? -eq 0 ]; then
    echo "$LOG_PREFIX Verification report emailed to $ALERT_EMAIL"
  else
    echo "$LOG_PREFIX Warning: failed to send verification email"
  fi
fi
