# Photo Search — Next Steps & Operations Guide

> Written: 2026-03-14
> Processing started: 2026-03-14 ~11:45pm
> Expected completion: ~2026-03-18 (4 days)

## What's Running Now

Three batch processing jobs were started on the Alpaca Mac (Intel, CPU-only):

| Job | tmux session | Script | Est. Duration |
|-----|-------------|--------|---------------|
| SigLIP 2 Embeddings | `embed` | `embed_photos.py` | ~6-8 hours (CPU) |
| Moondream 2 Captions | `caption` | `caption_photos.py` | ~3-4 days (CPU) |
| Face Detection | `faces` | `index_faces.py` | ~2-3 days (CPU) |

All jobs are **resume-safe** — they skip already-processed photos on restart.

## Checking Progress

```bash
# SSH into the Alpaca Mac
ssh alpacamac

# Activate the Python environment
cd ~/file-search-api
source venv/bin/activate

# Quick status for each pipeline
python embed_photos.py --status
python caption_photos.py --status
python index_faces.py --status

# API-level status (if API is running)
curl http://localhost:5001/status

# Watch logs in real-time
tail -f ~/file-search-api/logs/embed_photos.log
tail -f ~/file-search-api/logs/caption_photos.log
tail -f ~/file-search-api/logs/index_faces.log
tail -f ~/file-search-api/logs/errors.log

# Attach to a tmux session to see console output
tmux attach -t embed
tmux attach -t caption
tmux attach -t faces
# (Ctrl+B, D to detach without stopping)
```

## If the Machine Gets Turned Off / Rebooted

All jobs are resume-safe. Here's how to restart everything:

### Step 1: SSH in and activate environment
```bash
ssh alpacamac
cd ~/file-search-api
source venv/bin/activate
```

### Step 2: Check what still needs processing
```bash
python embed_photos.py --status
python caption_photos.py --status
python index_faces.py --status
```

### Step 3: Restart the batch jobs in tmux
```bash
# Embeddings (if not 100% complete)
tmux new -s embed
cd ~/file-search-api && source venv/bin/activate
python embed_photos.py --batch-size 32
# Ctrl+B, D to detach

# Captions (if not 100% complete)
tmux new -s caption
cd ~/file-search-api && source venv/bin/activate
python caption_photos.py
# Ctrl+B, D to detach

# Face indexing (if not 100% complete)
tmux new -s faces
cd ~/file-search-api && source venv/bin/activate
python index_faces.py
# Ctrl+B, D to detach
```

### Step 4: Restart the API
```bash
tmux new -s api
cd ~/file-search-api && source venv/bin/activate
python app.py
# Ctrl+B, D to detach
```

### Quick restart (all-in-one)
```bash
ssh alpacamac "cd ~/file-search-api && source venv/bin/activate && \
  tmux new -d -s embed 'cd ~/file-search-api && source venv/bin/activate && python embed_photos.py' && \
  tmux new -d -s caption 'cd ~/file-search-api && source venv/bin/activate && python caption_photos.py' && \
  tmux new -d -s faces 'cd ~/file-search-api && source venv/bin/activate && python index_faces.py' && \
  tmux new -d -s api 'cd ~/file-search-api && source venv/bin/activate && python app.py'"
```

---

## After ~4 Days: What's Next

Once all three batch jobs finish, here's the roadmap:

### Immediate (Day 4-5)

1. **Verify all pipelines are 100%**
   ```bash
   python embed_photos.py --status
   python caption_photos.py --status
   python index_faces.py --status
   ```

2. **Run face clustering**
   ```bash
   python index_faces.py --cluster
   ```
   This groups detected faces into identity clusters using HDBSCAN.

3. **Verify API endpoints work end-to-end**
   ```bash
   # Health check
   curl http://localhost:5001/health

   # Full status
   curl http://localhost:5001/status

   # Test a semantic search
   curl -X POST http://localhost:5001/photo-search \
     -H "Content-Type: application/json" \
     -d '{"query": "sunset", "limit": 5}'
   ```

4. **Test from the frontend**
   - Go to the intranet photos page
   - Try a semantic search query
   - Verify thumbnails load
   - Verify preview/lightbox works

### Short-term (Week 2)

5. **Add caption search to the API**
   - Add a `/caption-search` endpoint that queries `captions_fts` via FTS5
   - Combine with semantic search for hybrid results (vector + keyword)

6. **Build the face gallery UI**
   - Display face clusters on the frontend
   - Allow labeling clusters with names
   - "Show all photos of [person]" query

7. **Optimize search performance**
   - If search is slow with 200K embeddings, consider:
     - Pre-loading embeddings into memory on API startup
     - Using FAISS for approximate nearest neighbor search
     - Caching frequent queries

### Medium-term (Week 3-4)

8. **Incremental indexing**
   - Set up a cron job or file watcher to process new photos automatically
   - Run embedding + caption + face detection on new files only

9. **Search quality improvements**
   - Hybrid search: combine SigLIP similarity + caption FTS5 scores
   - Add EXIF-based filters (date range, camera model)
   - Add file path/folder-based filters

10. **Face cluster management**
    - Admin UI to merge/split face clusters
    - Manual name assignment for clusters
    - "Find similar faces" feature

### Long-term

11. **Move to a more powerful backend** if CPU performance is a bottleneck
    - Consider the Oracle ARM instance or DigitalOcean droplet
    - Or upgrade the Alpaca Mac to Apple Silicon

12. **Vector database migration**
    - If the SQLite + brute-force approach becomes too slow
    - Options: pgvector (in Supabase), Qdrant, ChromaDB
