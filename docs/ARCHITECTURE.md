# Photo & File Indexing Architecture

> Load this doc for: understanding the backend photo search system, file indexing pipelines, face detection, or API internals.

## System Overview

```
┌─────────────────────┐     HTTPS      ┌──────────────────────────────────┐
│   finleg.net        │ ◄──────────────► files.alpacaplayhouse.com       │
│   (GitHub Pages)    │  Cloudflare    │ (Alpaca Mac — 192.168.1.74)     │
│   Next.js static    │  Tunnel        │ Flask API on port 5001          │
│                     │                │                                  │
│  /intranet/photos   │                │  SQLite: ~/file-search-api/     │
│  /intranet/files    │                │    file_index.db                │
└─────────────────────┘                └──────────────────────────────────┘
```

**Frontend:** Next.js 16 static export hosted on GitHub Pages at finleg.net
**Backend:** Flask API on the Alpaca Mac (Intel x86_64, macOS 12.7), exposed via Cloudflare Tunnel
**Database:** SQLite at `~/file-search-api/file_index.db`
**ML Runtime:** CPU (Intel x86_64 Mac, macOS 12.7) — no GPU acceleration

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/photo-search` | Semantic search via SigLIP 2 text encoding |
| `GET` | `/photo-exif/<file_id>` | EXIF metadata extraction |
| `GET` | `/thumbnail/<file_id>` | 300px JPEG thumbnail |
| `GET` | `/preview/<file_id>` | Full-resolution image |
| `GET` | `/health` | Health check + basic stats |
| `GET` | `/status` | Detailed pipeline progress for all indexing jobs |

---

## Database Schema

### `files` — File index (pre-existing)
All files on the Alpaca Mac indexed by the existing file crawler.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment file ID |
| `path` | TEXT | Absolute path on disk |
| `name` | TEXT | Filename |
| `ext` | TEXT | File extension (lowercase) |
| `size` | INTEGER | File size in bytes |
| `modified` | TIMESTAMP | Last modified time |
| `is_archived` | BOOLEAN | Whether file is archived |

### `embeddings` — SigLIP 2 image embeddings
768-dimensional vectors for semantic photo search.

| Column | Type | Description |
|--------|------|-------------|
| `file_id` | INTEGER PK | FK to files.id |
| `model` | TEXT | Model identifier (`siglip2-vit-b`) |
| `embedding` | BLOB | 768-dim float32 vector (3072 bytes) |
| `created_at` | TIMESTAMP | When embedding was generated |

### `captions` — Moondream 2 natural language captions
Generated descriptions for text-based search.

| Column | Type | Description |
|--------|------|-------------|
| `file_id` | INTEGER PK | FK to files.id |
| `model` | TEXT | Model identifier (`moondream2`) |
| `caption` | TEXT | Natural language description |
| `created_at` | TIMESTAMP | When caption was generated |

### `captions_fts` — FTS5 virtual table
Full-text search index over captions for keyword queries.

### `faces` — Detected faces
Individual face detections with bounding boxes and embeddings.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment |
| `file_id` | INTEGER | FK to files.id |
| `bbox_x/y/w/h` | REAL | Normalized bounding box (0-1) |
| `confidence` | REAL | Detection confidence |
| `embedding` | BLOB | Face embedding for clustering |
| `cluster_id` | INTEGER | FK to face_clusters.id |
| `created_at` | TIMESTAMP | Detection timestamp |

### `face_clusters` — Grouped face identities
Clusters of similar faces (same person).

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Cluster ID |
| `label` | TEXT | Optional human-assigned name |
| `representative_face_id` | INTEGER | Best face for this cluster |
| `count` | INTEGER | Number of faces in cluster |

### `face_indexed_files` — Face processing tracker
Tracks which photos have been processed for face detection.

| Column | Type | Description |
|--------|------|-------------|
| `file_id` | INTEGER PK | FK to files.id |
| `faces_found` | INTEGER | Number of faces detected |
| `created_at` | TIMESTAMP | When processed |

---

## Processing Pipelines

### Pipeline 1: SigLIP 2 Embeddings (`embed_photos.py`)

**Model:** `ViT-B-16-SigLIP2` (pretrained on WebLI)
**Output:** 768-dim float32 vector per photo
**Speed:** ~50ms/photo (batch size 32, MPS)
**Est. time for 200K photos:** ~2.8 hours

```
Photos (files table) → PIL.Image → SigLIP 2 preprocess → encode_image → L2 normalize → SQLite BLOB
```

- Resume-safe: skips already-embedded photos
- Batch processing with configurable batch size
- Progress tracking with ETA calculations

### Pipeline 2: Moondream 2 Captions (`caption_photos.py`)

**Model:** `vikhyatk/moondream2` (vision-language model)
**Output:** Natural language caption per photo
**Speed:** ~1.5s/photo (MPS)
**Est. time for 200K photos:** ~3.5 days

```
Photos → PIL.Image → Moondream encode_image → answer_question(prompt) → caption TEXT → FTS5 index
```

- Resume-safe: skips already-captioned photos
- Updates both `captions` table and `captions_fts` index
- Detailed prompt designed to capture people, activities, setting, colors, objects, text

### Pipeline 3: Face Detection & Clustering (`index_faces.py`)

**Detection:** InsightFace buffalo_l (preferred) or MTCNN fallback
**Embeddings:** InsightFace or InceptionResnetV1 (VGGFace2)
**Clustering:** HDBSCAN with cosine distance

```
Photos → face detection → bounding boxes + confidence → face embeddings → HDBSCAN clustering
```

- Two-stage: detection runs per-photo, clustering runs on accumulated embeddings
- Normalized bounding boxes (0-1) for resolution-independent storage
- Face clusters can be labeled with names after review

---

## Search Flow

### Semantic Search (POST /photo-search)

```
1. User types query: "sunset on the beach"
2. Frontend sends POST to files.alpacaplayhouse.com/photo-search
3. API encodes query text with SigLIP 2 tokenizer → text embedding (768-dim)
4. Loads ALL photo embeddings from SQLite
5. Computes cosine similarity (dot product of L2-normalized vectors)
6. Returns top-N results sorted by similarity score
7. Frontend displays results with thumbnails via /thumbnail/<file_id>
```

**Timing breakdown** (logged per request):
- `encode_ms`: Text encoding time
- `compare_ms`: Similarity computation time
- `total_ms`: End-to-end response time

### Caption Search (future)

```
1. User types keyword query
2. API queries captions_fts using FTS5 MATCH
3. Returns matching photos ranked by FTS5 relevance
```

---

## Logging System

All services use a shared logging framework (`logging_config.py`):

### Log Outputs
- **Console:** Human-readable format with timestamps
- **Per-service log file:** JSON-structured, rotating (10MB × 5 backups)
- **Shared error log:** All ERROR+ level entries from all services

### Log Location
```
~/file-search-api/logs/
├── api.log              # Flask API requests and responses
├── embed_photos.log     # Embedding pipeline progress
├── caption_photos.log   # Captioning pipeline progress
├── index_faces.log      # Face detection pipeline progress
└── errors.log           # Aggregated errors from all services
```

### What Gets Logged

**API (app.py):**
- Every request: method, path, origin, IP, response status, timing
- Search queries: query text, result count, top score, timing breakdown
- Errors: full stack traces with request context

**Embedding pipeline:**
- Job start/end with total counts
- Every batch: embedded count, errors, batch time, rate, ETA
- Checkpoints every 100 batches
- Model load time and device

**Caption pipeline:**
- Job start/end with total counts
- Every 10th photo: file_id, caption length, rate, ETA
- Checkpoints every 100 photos
- Total time with days estimate for long runs

**Face indexing:**
- Job start/end with total counts
- Every photo with faces: face count, confidence scores
- Progress updates every 50 photos (no-face photos)
- Clustering results: cluster count, noise points
- Checkpoints every 200 photos

### Monitoring Commands
```bash
# Check pipeline progress
python embed_photos.py --status
python caption_photos.py --status
python index_faces.py --status

# API health
curl http://localhost:5001/health
curl http://localhost:5001/status

# Tail logs
tail -f ~/file-search-api/logs/api.log | python -m json.tool
tail -f ~/file-search-api/logs/errors.log

# Watch all services
tail -f ~/file-search-api/logs/*.log
```

---

## Deployment

### Alpaca Mac Setup
```bash
cd ~/file-search-api
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Start API (production)
gunicorn -w 2 -b 0.0.0.0:5001 app:app

# Or development
python app.py
```

### Cloudflare Tunnel
The API is exposed to the internet via Cloudflare Tunnel:
- Internal: `http://192.168.1.74:5001`
- External: `https://files.alpacaplayhouse.com`

### Running Batch Jobs
```bash
# Run in tmux/screen sessions for long jobs
tmux new -s embed
python embed_photos.py --batch-size 64

tmux new -s caption
python caption_photos.py

tmux new -s faces
python index_faces.py
```

---

## File Structure (server/)

```
server/
├── app.py               # Flask API server
├── embed_photos.py      # Phase 1: SigLIP 2 embedding pipeline
├── caption_photos.py    # Phase 3: Moondream 2 captioning pipeline
├── index_faces.py       # Phase 4: Face detection & clustering
├── logging_config.py    # Shared logging configuration
└── requirements.txt     # Python dependencies
```

---

## Photo Extensions Supported

`jpg`, `jpeg`, `png`, `heic`, `webp`, `gif`, `bmp`, `tiff`, `tif`

All pipelines filter on these extensions when querying the `files` table.
