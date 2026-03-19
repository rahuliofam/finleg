# Backup & Recovery

> How finleg data is backed up, and how to restore it.

---

## Backup Sources

| Layer | What | Backup Method | Retention |
|---|---|---|---|
| **Supabase DB** | All tables, functions, RLS | `scripts/backup-db-to-r2.sh` → R2 | 12 weekly dumps |
| **Supabase DB** | Platform backup | Supabase dashboard (automatic daily) | 7 days (Pro plan) |
| **Cloudflare R2** | 1,880 financial documents | Source files on local disk + R2 | Originals on RVAULT20 |
| **Code** | All application code | Git (GitHub) | Full history |
| **Releases** | Version history | `releases` table + git tags (`r80`, `r81`, ...) | Permanent |

---

## 1. Automated Database Backup (pg_dump → R2)

**Script:** `scripts/backup-db-to-r2.sh`
**Schedule:** Weekly on Hostinger VPS (cron, Sunday 3am UTC)
**Destination:** `finleg-backups` R2 bucket → `db-backups/` prefix
**Retention:** Last 12 backups (auto-pruned)

### Setup on Hostinger

```bash
# SSH into Hostinger
sshpass -f ~/.ssh/alpacapps-hostinger.pass ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no root@93.188.164.224

# Install prerequisites
apt install -y postgresql-client-16 awscli

# Create env file with credentials
cat > ~/.env-finleg << 'EOF'
SUPABASE_DB_URL=postgresql://postgres.gjdvzzxsrzuorguwkaih:PASSWORD@aws-0-us-west-1.pooler.supabase.com:6543/postgres
R2_ACCOUNT_ID=1417f040cdffb8ba923a28be80d095b6
R2_ACCESS_KEY_ID=<from .env>
R2_SECRET_ACCESS_KEY=<from .env>
R2_BACKUP_BUCKET=finleg-backups
EOF
chmod 600 ~/.env-finleg

# Clone repo (or just the script)
git clone https://github.com/rahuliofam/finleg.git /root/finleg

# Test
/root/finleg/scripts/backup-db-to-r2.sh --dry-run
/root/finleg/scripts/backup-db-to-r2.sh

# Add weekly cron
crontab -e
# 0 3 * * 0 /root/finleg/scripts/backup-db-to-r2.sh >> /var/log/finleg-backup.log 2>&1
```

### Manual Backup (local)

```bash
# From project root (uses .env / local.env)
./scripts/backup-db-to-r2.sh           # full backup
./scripts/backup-db-to-r2.sh --tables  # critical tables only (faster)
./scripts/backup-db-to-r2.sh --dry-run # preview only
```

---

## 2. Restore from Backup

### Option A: Restore from pg_dump (R2)

```bash
# List available backups
AWS_ACCESS_KEY_ID=$R2_ACCESS_KEY_ID \
AWS_SECRET_ACCESS_KEY=$R2_SECRET_ACCESS_KEY \
aws s3 ls s3://finleg-backups/db-backups/ \
  --endpoint-url https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com

# Download and restore (CAUTION: this overwrites existing data)
AWS_ACCESS_KEY_ID=$R2_ACCESS_KEY_ID \
AWS_SECRET_ACCESS_KEY=$R2_SECRET_ACCESS_KEY \
aws s3 cp s3://finleg-backups/db-backups/full-20260316-030000.sql.gz - \
  --endpoint-url https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com \
| gunzip \
| psql "$SUPABASE_DB_URL"
```

### Option B: Restore from Supabase Dashboard

1. Go to https://supabase.com/dashboard/project/gjdvzzxsrzuorguwkaih/backups
2. Select a daily backup (last 7 days available)
3. Click "Restore" — this replaces the entire database

### Option C: Restore a Single Table

```bash
# Dump just one table from the backup file
AWS_ACCESS_KEY_ID=$R2_ACCESS_KEY_ID \
AWS_SECRET_ACCESS_KEY=$R2_SECRET_ACCESS_KEY \
aws s3 cp s3://finleg-backups/db-backups/full-20260316-030000.sql.gz - \
  --endpoint-url https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com \
| gunzip \
| grep -A 99999 'CREATE TABLE public.document_index' \
| sed '/^--$/q' \
| psql "$SUPABASE_DB_URL"

# Or use the pre-migration dump (if recovering from a bad migration):
gunzip < backups/pre-migration-015-document_index.sql.gz | psql "$SUPABASE_DB_URL"
```

---

## 3. Restore Verification Checklist

Run this after any restore to verify data integrity:

```bash
# Connect to DB
psql "$SUPABASE_DB_URL"

-- Check row counts against known values
SELECT 'document_index' AS t, count(*) FROM document_index
UNION ALL SELECT 'qb_general_ledger', count(*) FROM qb_general_ledger
UNION ALL SELECT 'app_users', count(*) FROM app_users
UNION ALL SELECT 'releases', count(*) FROM releases
UNION ALL SELECT 'thoughts', count(*) FROM thoughts;

-- Expected minimums (as of 2026-03-16):
-- document_index:    ~1,880
-- qb_general_ledger: ~9,288
-- app_users:         3+
-- releases:          80+
-- thoughts:          varies

-- Verify RLS is still active
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = true;

-- Verify key functions exist
SELECT proname FROM pg_proc WHERE proname IN ('is_admin', 'record_release_event', 'match_thoughts');
```

---

## 4. Code Rollback

Every release is git-tagged as `rNN` (e.g., `r80`, `r81`).

```bash
# See recent releases
git tag -l 'r*' --sort=-version:refname | head -10

# Roll back to a specific release
git revert HEAD    # revert last commit
git push origin main   # triggers redeploy

# Or deploy a specific release (nuclear option)
git checkout r79
# Copy out/ and manually deploy, or:
git reset --hard r79 && git push --force origin main  # DESTRUCTIVE — last resort
```

---

## 5. Pre-Migration Safety

Before running any migration, use the wrapper script:

```bash
# Backs up affected tables, then runs the migration
./scripts/run-migration.sh supabase/migrations/016_new_feature.sql

# Or manually dump specific tables before a risky change
./scripts/run-migration.sh --dump-only document_index qb_general_ledger
```

Pre-migration dumps are saved to `backups/` (gitignored) with timestamps.

---

## 6. Google Drive Sync (rclone → RVAULT20)

**Script:** `~/scripts/sync-gdrive-to-rvault.sh` (on Alpaca Mac)
**Schedule:** Daily at 2am via crontab
**Destination:** `/Volumes/RVAULT20/GDriveSync/`

### Remotes

| Remote | Account | Local Path |
|--------|---------|------------|
| `gdrive:` | rahulioson@gmail.com | `GDriveSync/googledrivesync-rahulioson/` |
| `gdrive-tesloop:` | rahulio@tesloop.com | `GDriveSync/googledrivesync-tesloop/` |

### Usage (SSH to Alpaca Mac)

```bash
ssh alpacamac

# Sync both accounts
~/scripts/sync-gdrive-to-rvault.sh

# Sync one account only
~/scripts/sync-gdrive-to-rvault.sh rahulioson
~/scripts/sync-gdrive-to-rvault.sh tesloop

# Preview what would sync
~/scripts/sync-gdrive-to-rvault.sh --dry-run

# Check logs
tail -50 ~/logs/gdrive-sync.log

# Check if sync is running
ps aux | grep rclone | grep -v grep
```

### Re-auth (if tokens expire)

Refresh tokens auto-renew, but if a remote stops working:

```bash
ssh alpacamac
/usr/local/bin/rclone config reconnect gdrive:         # rahulioson@gmail.com
/usr/local/bin/rclone config reconnect gdrive-tesloop:  # rahulio@tesloop.com
```

This requires browser auth — run from a session with display access (VNC/Screen Sharing).

### Notes

- Uses `rclone sync` (mirror mode) — files deleted from Drive will be deleted locally
- Excludes `.DS_Store`, `.tmp`, `.Trash`
- 4 parallel transfers, fast-list enabled for speed
- Google Photos sync (`gphotos:`) is configured but not included in the automated job — Google Photos API has severe rate limits that make full sync impractical

---

## 7. R2 File Recovery

R2 files are uploaded from local source files. If R2 data is lost:

```bash
# Re-upload everything from source
node scripts/upload-r2-index.mjs

# Source location:
# /Users/rahulio/Documents/CodingProjects/noncode/Finleg/AI Financial/Current Sonnad Accounting Files - Amanda 2022+
# Also available on RVAULT20 (SSH to Alpaca Mac)
```
