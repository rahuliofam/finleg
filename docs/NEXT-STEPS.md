# Photo Search — What Needs to Happen Next

> Last updated: 2026-03-15

## Current State

**Alpaca Mac** (Intel x86_64, 4 cores, macOS 12.7, `ssh alpacamac`)

- **Database:** `~/rvault20_index.db` — 885K files indexed, 470K photos with EXIF metadata
- **Thumbnails:** `batch-thumbnails.py` is running (2 workers, ~185% CPU). Let it finish.
- **Python 3.12 venv:** Created at `~/file-search-api/venv` with torch 2.2.2, open-clip, transformers 4.57.6, numpy 1.26.4
- **insightface/OpenCV:** Was compiling from source — check if it finished
- **ML batch jobs:** NOT running (killed to free CPU for thumbnails)
- **Flask API:** Running on port 8200 via gunicorn (the original `app.py`, not the new one)
- **Scripts deployed:** `embed_photos.py`, `caption_photos.py`, `index_faces.py`, `logging_config.py` are in `~/file-search-api/`

## Step-by-Step: What To Do Next

### 1. Check if thumbnails finished

```bash
ssh alpacamac
ps aux | grep batch-thumbnails | grep -v grep
```

If no output → thumbnails are done. If still running, wait or check progress.

### 2. Check if insightface installed

```bash
cd ~/file-search-api
source venv/bin/activate
python -c "import insightface; print('insightface OK')"
```

If it errors, re-run the install (should be faster now with free CPU):
```bash
pip install insightface onnxruntime scikit-learn
```

### 3. Install tmux (if not already done)

```bash
eval "$(/usr/local/bin/brew shellenv zsh)"
brew install tmux
```

### 4. Start all ML batch jobs

Run them one at a time in separate tmux sessions so they persist after SSH disconnect:

```bash
# Embeddings — ~6-8 hours for 470K photos on CPU
tmux new -s embed
cd ~/file-search-api && source venv/bin/activate
python embed_photos.py --batch-size 16
# Press Ctrl+B, then D to detach

# Captions — ~3-4 days for 470K photos on CPU
tmux new -s caption
cd ~/file-search-api && source venv/bin/activate
python caption_photos.py
# Press Ctrl+B, then D to detach

# Face detection — ~2-3 days for 470K photos on CPU
tmux new -s faces
cd ~/file-search-api && source venv/bin/activate
python index_faces.py
# Press Ctrl+B, then D to detach
```

Or start all at once (but they'll compete for CPU — consider running sequentially):
```bash
nohup python embed_photos.py --batch-size 16 > logs/embed_console.log 2>&1 &
nohup python caption_photos.py > logs/caption_console.log 2>&1 &
nohup python index_faces.py > logs/faces_console.log 2>&1 &
```

### 5. Monitor progress

```bash
# Quick status (no GPU, no model loading — instant)
python embed_photos.py --status
python caption_photos.py --status
python index_faces.py --status

# Watch logs
tail -f ~/file-search-api/logs/embed_photos.log
tail -f ~/file-search-api/logs/caption_photos.log
tail -f ~/file-search-api/logs/index_faces.log
tail -f ~/file-search-api/logs/errors.log

# Attach to tmux session
tmux attach -t embed    # Ctrl+B, D to detach
```

All jobs are **resume-safe** — they skip already-processed photos. Safe to restart anytime.

---

## After ML Jobs Finish (~4 days)

### 6. Run face clustering

```bash
python index_faces.py --cluster
```

Groups detected faces into identity clusters using HDBSCAN.

### 7. Verify API endpoints

The current API (`app.py` on port 8200) is the original file search API. The new `app.py` in `~/file-search-api/` adds semantic search + face search endpoints. To switch:

```bash
# Stop old gunicorn
pkill -f "gunicorn.*app:app"

# Start new API
tmux new -s api
cd ~/file-search-api && source venv/bin/activate
python app.py
# Or with gunicorn:
gunicorn -w 2 -b 0.0.0.0:5001 --timeout 120 app:app
```

Test endpoints:
```bash
curl http://localhost:5001/health
curl http://localhost:5001/status
curl -X POST http://localhost:5001/photo-search \
  -H "Content-Type: application/json" \
  -d '{"query": "sunset", "limit": 5}'
```

### 8. Test from the frontend

- Go to the intranet photos page on https://finleg.net
- Try a semantic search query
- Verify thumbnails and lightbox work

### 9. Add caption search

- Add `/caption-search` endpoint querying `captions_fts` via FTS5
- Hybrid search: combine SigLIP vector similarity + caption keyword scores

### 10. Build face gallery UI

- Display face clusters on frontend
- Label clusters with names
- "Show all photos of [person]" query

### 11. Incremental indexing

- Cron job or file watcher to auto-process new photos
- Run embed + caption + face on new files only

### 12. Performance optimization (if needed)

- Pre-load embeddings into memory on API startup
- FAISS for approximate nearest neighbor if brute-force is too slow
- Cache frequent queries

---

## Key Facts

| Item | Value |
|------|-------|
| Alpaca Mac SSH | `ssh alpacamac` |
| Architecture | Intel x86_64, 4 cores, macOS 12.7 |
| Python | 3.12.13 in `~/file-search-api/venv` |
| PyTorch | 2.2.2 (CPU only — max version for Intel Mac) |
| Database | `~/rvault20_index.db` (991MB, 885K files, 470K photos) |
| Total photos | 470,170 |
| API (current) | port 8200 via gunicorn |
| API (new) | port 5001 (not yet running) |
| Cloudflare Tunnel | `https://files.alpacaplayhouse.com` → port 8200 |
| Logs | `~/file-search-api/logs/` |
