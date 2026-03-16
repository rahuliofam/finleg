# Photo Caption Operations

## Overview

Moondream 2 captioning runs nightly on the **MacBook Air M4 (24GB RAM)**, reading photos from RVAULT20 over SMB and writing captions to a local SQLite DB. The script is resume-safe — stop/start anytime with zero rework.

- **Photos:** 470,170 indexed in `rvault20_index.db`
- **Model:** Moondream 2 (vikhyatk/moondream2) via HuggingFace transformers
- **Device:** MPS (Apple Neural Engine on M4)
- **Speed:** ~4.4s/photo over SMB, ~1.5-2s/photo with USB-direct drive
- **Overnight estimate (~10 hrs):** ~8,000 photos (SMB) / ~24,000 photos (USB)
- **Total estimated time:** ~55 nights (SMB) / ~20 nights (USB)

## File Locations

| File | Location |
|---|---|
| Caption script | `~/file-search-api/caption_photos.py` |
| Logging config | `~/file-search-api/logging_config.py` |
| Local DB (working copy) | `~/file-search-api/rvault20_index.db` (998 MB) |
| Master DB (Alpaca Mac) | `alpacamac:~/rvault20_index.db` |
| Python venv | `~/file-search-api/venv/` (Python 3.14, torch 2.10, transformers 4.57.6) |
| Log output | `/tmp/caption.log` |
| Structured logs | `~/file-search-api/logs/caption_photos.log` |

## Nightly Commands

### Start (evening)

```bash
# 1. Mount RVAULT20 over SMB (if not already mounted)
open 'smb://alpaca@192.168.1.74/rvault20'

# 2. Launch caption job
cd ~/file-search-api && source venv/bin/activate
nohup python3 caption_photos.py > /tmp/caption.log 2>&1 &
```

### Check Progress

```bash
tail -20 /tmp/caption.log
```

### Stop (morning)

```bash
kill $(pgrep -f caption_photos)
```

### Restart After Any Interruption

```bash
# 1. Remount RVAULT20 if needed
open 'smb://alpaca@192.168.1.74/rvault20'

# 2. Kill any zombie process
kill $(pgrep -f caption_photos) 2>/dev/null

# 3. Restart
cd ~/file-search-api && source venv/bin/activate
nohup python3 caption_photos.py > /tmp/caption.log 2>&1 &

# 4. Verify
tail -f /tmp/caption.log
```

## Resource Usage

- **RAM:** ~4-5 GB (model weights in float16)
- **GPU (MPS):** Heavy — uses Neural Engine/GPU cores
- **CPU:** Light — just data loading
- **Battery:** Drains fast — **plug in charger**
- **Fan:** May spin up, laptop will get warm
- **Usability:** Browsing/email fine, avoid heavy GPU tasks (video editing, gaming)

## Ungraceful Disconnect / Crash

No problems. Each caption is committed individually to SQLite after each photo. Worst case you lose the one photo that was mid-caption. On restart, the script skips all previously captioned photos automatically.

If the lid closes, macOS suspends the process. It resumes when you open the lid — no data loss, just paused time.

## Path Remapping

The drive was reorganized after indexing. The script handles this automatically:

| DB path prefix | Actual path on disk |
|---|---|
| `/Volumes/rvault20/2025 Backup Mac/` | `/Volumes/rvault20/BackupsRS/2025 Backup Mac/` |
| `/Volumes/rvault20/2024 Backups/` | `/Volumes/rvault20/BackupsRS/2024 Backups/` |

97% of photos (456,949) are in the `2025 Backup Mac` path. 3% (13,221) are in `2024 Backups`.

## Resource Fork Files

macOS `._` prefixed files (resource forks) are automatically skipped and marked as `[resource_fork_skipped]` in the captions table so they aren't retried.

## Syncing DB Back to Alpaca Mac

When captioning is complete (or periodically), sync the local DB back:

```bash
# Copy local DB to Alpaca Mac
scp ~/file-search-api/rvault20_index.db alpacamac:~/rvault20_index.db
```

**Important:** If Alpaca Mac's embedding job has also been writing to its DB, you'll need to merge rather than overwrite. The tables are independent (embeddings vs captions), so a merge script would:
1. Copy captions + captions_fts from local DB into Alpaca Mac's DB
2. Preserve embeddings already in Alpaca Mac's DB

```sql
-- On Alpaca Mac, attach local DB and merge captions
ATTACH DATABASE '/path/to/local_copy.db' AS local;
INSERT OR REPLACE INTO captions SELECT * FROM local.captions;
-- Rebuild FTS index
INSERT INTO captions_fts(captions_fts) VALUES('rebuild');
DETACH DATABASE local;
```

## Parallel Jobs Running

| Machine | Job | PID | Script |
|---|---|---|---|
| Alpaca Mac (Intel i5) | SigLIP embeddings | 61843 | `~/file-search-api/embed_photos.py` |
| MacBook Air M4 | Moondream captions | 37991 | `~/file-search-api/caption_photos.py` |

## Speeding Up

To get ~3x faster captioning, plug RVAULT20 directly into the M4 Air via USB. This eliminates SMB network latency. The mount path stays the same (`/Volumes/rvault20`), so no script changes needed.
