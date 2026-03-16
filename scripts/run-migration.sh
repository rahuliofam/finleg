#!/bin/bash
# run-migration.sh — Safely run a Supabase migration with a pre-migration backup.
#
# Dumps affected tables before executing the migration SQL, so you can
# roll back if something goes wrong.
#
# Usage:
#   ./scripts/run-migration.sh supabase/migrations/016_new_feature.sql
#   ./scripts/run-migration.sh --dump-only document_index qb_general_ledger
#   ./scripts/run-migration.sh --dry-run supabase/migrations/016_new_feature.sql
#
# Pre-migration dumps are saved to backups/ (gitignored).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load env
for envfile in "$HOME/.env-finleg" "$PROJECT_ROOT/.env" "$PROJECT_ROOT/local.env"; do
  [ -f "$envfile" ] && export $(grep -v '^#' "$envfile" | grep '=' | xargs) 2>/dev/null || true
done

DB_URL="${SUPABASE_DB_URL:-}"
[ -z "$DB_URL" ] && { echo "ERROR: SUPABASE_DB_URL is required" >&2; exit 1; }

# Resolve psql
if [ -x "/opt/homebrew/opt/libpq/bin/psql" ]; then
  PSQL="/opt/homebrew/opt/libpq/bin/psql"
  PGDUMP="/opt/homebrew/opt/libpq/bin/pg_dump"
elif command -v psql &>/dev/null; then
  PSQL="psql"
  PGDUMP="pg_dump"
else
  echo "ERROR: psql not found" >&2; exit 1
fi

# ── parse args ───────────────────────────────────────────────────────
DRY_RUN=false
DUMP_ONLY=false
MIGRATION_FILE=""
EXPLICIT_TABLES=()

while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run)   DRY_RUN=true; shift ;;
    --dump-only) DUMP_ONLY=true; shift ;;
    *.sql)       MIGRATION_FILE="$1"; shift ;;
    *)           EXPLICIT_TABLES+=("$1"); shift ;;
  esac
done

# ── determine tables to dump ────────────────────────────────────────
TABLES=()

if [ ${#EXPLICIT_TABLES[@]} -gt 0 ]; then
  TABLES=("${EXPLICIT_TABLES[@]}")
elif [ -n "$MIGRATION_FILE" ]; then
  # Auto-detect tables mentioned in the migration SQL
  if [ ! -f "$MIGRATION_FILE" ]; then
    echo "ERROR: Migration file not found: $MIGRATION_FILE" >&2
    exit 1
  fi

  # Extract table names from common SQL patterns
  DETECTED=$(grep -oiE '(CREATE|ALTER|DROP|INSERT INTO|UPDATE|DELETE FROM|TRUNCATE)\s+(TABLE\s+)?(IF\s+(NOT\s+)?EXISTS\s+)?((public\.)?[a-z_][a-z0-9_]*)' "$MIGRATION_FILE" \
    | grep -oE '[a-z_][a-z0-9_]*$' \
    | sort -u \
    | grep -vE '^(table|public|exists|not|if)$' || true)

  if [ -n "$DETECTED" ]; then
    while IFS= read -r t; do
      [ -n "$t" ] && TABLES+=("$t")
    done <<< "$DETECTED"
  fi

  echo "Auto-detected tables from migration: ${TABLES[*]:-none}"
fi

if [ ${#TABLES[@]} -eq 0 ] && [ "$DUMP_ONLY" = false ] && [ -n "$MIGRATION_FILE" ]; then
  echo "WARNING: No tables detected in migration. Doing full schema dump as safety net."
  TABLES=("__full_schema__")
fi

# ── create backup dir ────────────────────────────────────────────────
BACKUP_DIR="$PROJECT_ROOT/backups"
mkdir -p "$BACKUP_DIR"

# Add to .gitignore if not already there
if ! grep -q '^backups/' "$PROJECT_ROOT/.gitignore" 2>/dev/null; then
  echo 'backups/' >> "$PROJECT_ROOT/.gitignore"
fi

DATE=$(date -u +"%Y%m%d-%H%M%S")
MIGRATION_NAME=""
if [ -n "$MIGRATION_FILE" ]; then
  MIGRATION_NAME=$(basename "$MIGRATION_FILE" .sql)
fi

# ── dump tables ──────────────────────────────────────────────────────
echo "=== Pre-migration backup ==="
echo "Date: $DATE"
[ -n "$MIGRATION_FILE" ] && echo "Migration: $MIGRATION_FILE"

for table in "${TABLES[@]}"; do
  if [ "$table" = "__full_schema__" ]; then
    DUMP_NAME="backups/pre-migration-${MIGRATION_NAME:-manual}-full-${DATE}.sql.gz"
    echo "Dumping full public schema → $DUMP_NAME"
    if [ "$DRY_RUN" = false ]; then
      $PGDUMP "$DB_URL" --schema=public --no-owner --no-privileges | gzip > "$PROJECT_ROOT/$DUMP_NAME"
      SIZE=$(du -h "$PROJECT_ROOT/$DUMP_NAME" | cut -f1)
      echo "  Done ($SIZE)"
    fi
  else
    DUMP_NAME="backups/pre-migration-${MIGRATION_NAME:-manual}-${table}-${DATE}.sql.gz"
    echo "Dumping $table → $DUMP_NAME"
    if [ "$DRY_RUN" = false ]; then
      $PGDUMP "$DB_URL" -t "public.$table" --no-owner --no-privileges --clean --if-exists | gzip > "$PROJECT_ROOT/$DUMP_NAME"
      SIZE=$(du -h "$PROJECT_ROOT/$DUMP_NAME" | cut -f1)
      echo "  Done ($SIZE)"
    fi
  fi
done

if [ "$DUMP_ONLY" = true ]; then
  echo "=== Dump-only mode — migration not executed ==="
  exit 0
fi

# ── run migration ────────────────────────────────────────────────────
if [ -z "$MIGRATION_FILE" ]; then
  echo "No migration file specified. Backups created."
  exit 0
fi

if [ "$DRY_RUN" = true ]; then
  echo "=== DRY RUN — would execute: ==="
  echo "  $PSQL \$SUPABASE_DB_URL < $MIGRATION_FILE"
  exit 0
fi

echo ""
echo "=== Running migration: $MIGRATION_FILE ==="
$PSQL "$DB_URL" < "$MIGRATION_FILE"
echo "=== Migration complete ==="

echo ""
echo "Backup files saved in backups/. To roll back a table:"
echo "  gunzip < backups/pre-migration-...-TABLE-....sql.gz | psql \$SUPABASE_DB_URL"
