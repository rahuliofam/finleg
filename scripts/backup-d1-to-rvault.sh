#!/bin/bash
# backup-d1-to-rvault.sh — Export Cloudflare D1 (claude-sessions) to RVAULT20.
#
# Uses wrangler CLI to export the D1 database as SQL, then saves it to
# RVAULT20 alongside the other finleg backups.
#
# Runs on Alpaca Mac via cron (monthly, 1st Sunday 6am local).
#
# Prerequisites:
#   - npx + wrangler (npm install -g wrangler, or uses npx)
#   - Wrangler auth config at ~/.wrangler/config/default.toml (OAuth refresh token)
#   - RVAULT20 mounted at /Volumes/RVAULT20 (or /Volumes/rvault20)
#   - Finleg repo cloned (for wrangler.jsonc with D1 binding)
#   - Environment in ~/.env-finleg
#
# Usage:
#   ./backup-d1-to-rvault.sh              # full export
#   ./backup-d1-to-rvault.sh --dry-run    # show what would happen
#
# Cron example (1st Sunday of month, 6am local):
#   0 6 1-7 * 0 PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin /Users/alpuca/scripts/backup-d1-to-rvault.sh >> /Users/alpuca/logs/d1-backup.log 2>&1

set -uo pipefail

# ── config ───────────────────────────────────────────────────────────
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"
D1_DATABASE_NAME="claude-sessions"
# wrangler.jsonc location (needs D1 binding definition)
WRANGLER_DIR="$HOME/finleg/cloudflare/claude-sessions"

# Load env
ENVFILE="$HOME/.env-finleg"
if [ -f "$ENVFILE" ]; then
  export $(grep -v '^#' "$ENVFILE" | grep '=' | xargs) 2>/dev/null || true
fi

SUPABASE_URL="${SUPABASE_URL:-https://gjdvzzxsrzuorguwkaih.supabase.co}"
SUPABASE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
START_TIME=$(date +%s)

# Find RVAULT20 mount (case-insensitive)
if [ -d "/Volumes/RVAULT20" ]; then
  BACKUP_ROOT="/Volumes/RVAULT20/BackupsRS/finleg"
elif [ -d "/Volumes/rvault20" ]; then
  BACKUP_ROOT="/Volumes/rvault20/BackupsRS/finleg"
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

# ── validate ─────────────────────────────────────────────────────────
if ! command -v npx >/dev/null 2>&1; then
  echo "$LOG_PREFIX ERROR: npx not found (need Node.js installed)" >&2
  exit 1
fi

if [ ! -d "$WRANGLER_DIR" ]; then
  echo "$LOG_PREFIX ERROR: Wrangler project dir not found at $WRANGLER_DIR" >&2
  echo "$LOG_PREFIX Run: git clone https://github.com/rahuliofam/finleg.git ~/finleg" >&2
  exit 1
fi

# ── dry run ──────────────────────────────────────────────────────────
DATE=$(date -u +"%Y%m%d-%H%M%S")
DEST_DIR="$BACKUP_ROOT/d1"
DEST_FILE="$DEST_DIR/${D1_DATABASE_NAME}-${DATE}.sql"

if [ "$DRY_RUN" = true ]; then
  echo "=== DRY RUN ==="
  echo "D1 Database: $D1_DATABASE_NAME"
  echo "Wrangler dir: $WRANGLER_DIR"
  echo "Command: npx wrangler d1 export $D1_DATABASE_NAME --remote --output $DEST_FILE"
  echo "Destination: $DEST_FILE"
  exit 0
fi

# ── export D1 database ──────────────────────────────────────────────
echo "$LOG_PREFIX Starting D1 export: $D1_DATABASE_NAME"

mkdir -p "$DEST_DIR"

# Use wrangler d1 export (requires wrangler.jsonc with D1 binding)
echo "$LOG_PREFIX Running wrangler d1 export..."
cd "$WRANGLER_DIR"

# wrangler may exit non-zero due to interactive prompt in non-TTY, but still download the file
EXPORT_OUTPUT=$(wrangler d1 export "$D1_DATABASE_NAME" --remote --output "$DEST_FILE" 2>&1) || true

echo "$LOG_PREFIX $EXPORT_OUTPUT"

if [ ! -f "$DEST_FILE" ] || [ ! -s "$DEST_FILE" ]; then
  echo "$LOG_PREFIX ERROR: Export file is empty or missing" >&2
  exit 1
fi

SIZE=$(du -h "$DEST_FILE" | cut -f1)
ROWS=$(grep -c '^INSERT' "$DEST_FILE" 2>/dev/null || echo "0")
echo "$LOG_PREFIX Export complete: $DEST_FILE ($SIZE, $ROWS rows)"

# ── prune old exports (keep last 6) ────────────────────────────────
OLD_FILES=$(ls -t "$DEST_DIR"/${D1_DATABASE_NAME}-*.sql 2>/dev/null | tail -n +7)
if [ -n "$OLD_FILES" ]; then
  echo "$LOG_PREFIX Pruning old D1 exports..."
  echo "$OLD_FILES" | xargs rm -f
fi

# ── log to Supabase ──────────────────────────────────────────────────
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
if [ -n "$SUPABASE_KEY" ]; then
  curl -sf "$SUPABASE_URL/rest/v1/backup_logs" \
    -H "apikey: $SUPABASE_KEY" \
    -H "Authorization: Bearer $SUPABASE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"source\":\"alpaca-mac\",\"backup_type\":\"d1-to-rvault\",\"status\":\"success\",\"duration_seconds\":$DURATION,\"details\":{\"database\":\"$D1_DATABASE_NAME\",\"size\":\"$SIZE\",\"rows\":$ROWS,\"file\":\"$(basename "$DEST_FILE")\"}}" \
    >/dev/null 2>&1 || echo "$LOG_PREFIX Warning: failed to log to Supabase"
fi

echo "$LOG_PREFIX D1 backup complete."
