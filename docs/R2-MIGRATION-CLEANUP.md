# R2 Migration Cleanup — For AlpacApps Session

> This doc is for a session running on the **alpacapps** project to clean up the old R2 buckets
> on the wingsiebird Cloudflare account after finleg's buckets have been migrated.

## Context

Finleg's R2 buckets were originally created on the **wingsiebird@gmail.com** Cloudflare account
(`9cd3a280a54ce2a5b382602f0247b577`) alongside the `alpacapps` bucket. They have been migrated
to the **Rah Hui Lio Son Fami** account (`1417f040cdffb8ba923a28be80d095b6`).

## What to Delete (wingsiebird account)

After confirming finleg's new buckets are fully populated and working:

| Bucket | Objects | Size | Action |
|---|---|---|---|
| `financial-statements` | 1,337 | ~362 MB | **DELETE** — migrated to new account |
| `bookkeeping-docs` | 1,044 | ~764 MB | **DELETE** — migrated to new account |
| `legal-docs` | 47 | ~90 MB | **DELETE** — migrated to new account |
| `finleg-backups` | 0 | 0 | **DELETE** — recreated on new account |
| `alpacapps` | 30 | ~119 MB | **KEEP** — belongs to alpacapps project |

## Verification Steps (run BEFORE deleting)

```bash
# 1. Verify new account has correct object counts
NEW_ENDPOINT="https://1417f040cdffb8ba923a28be80d095b6.r2.cloudflarestorage.com"
# Use finleg's new R2 credentials (1Password: DevOps-finleg → "Cloudflare R2 — Finleg Object Storage")

for bucket in financial-statements bookkeeping-docs legal-docs; do
  echo "=== $bucket ==="
  AWS_ACCESS_KEY_ID=$NEW_KEY AWS_SECRET_ACCESS_KEY=$NEW_SECRET \
    aws s3 ls "s3://$bucket/" --endpoint-url "$NEW_ENDPOINT" --recursive --summarize 2>&1 | tail -3
done

# Expected:
# financial-statements: 1,337 objects
# bookkeeping-docs: 1,044 objects
# legal-docs: 47 objects

# 2. Spot-check a few files by downloading and comparing checksums
# (pick 3-5 random files from each bucket)

# 3. Verify finleg app works — visit https://finleg.net/intranet/filevault
#    and confirm files load correctly
```

## Deletion Commands

```bash
OLD_ENDPOINT="https://9cd3a280a54ce2a5b382602f0247b577.r2.cloudflarestorage.com"
# Use wingsiebird R2 credentials (1Password: DevOps-shared → "Cloudflare R2 — Object Storage")

# Empty each bucket first (required before deletion)
for bucket in financial-statements bookkeeping-docs legal-docs finleg-backups; do
  echo "Emptying $bucket..."
  AWS_ACCESS_KEY_ID=$OLD_KEY AWS_SECRET_ACCESS_KEY=$OLD_SECRET \
    aws s3 rm "s3://$bucket/" --endpoint-url "$OLD_ENDPOINT" --recursive
done

# Then delete the empty buckets via wrangler (authenticated to wingsiebird)
for bucket in financial-statements bookkeeping-docs legal-docs finleg-backups; do
  wrangler r2 bucket delete "$bucket"
done
```

## After Cleanup

- **Move** the 1Password entry "Cloudflare R2 — Object Storage" from **DevOps-shared** to **DevOps-alpacapps**
  (it's the wingsiebird account, which only has the `alpacapps` bucket now)
- Scope the wingsiebird R2 API keys down to just the `alpacapps` bucket if desired
