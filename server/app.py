#!/usr/bin/env python3
"""
File Search API — Flask server for photo search, thumbnails, EXIF, and previews.
Runs on Alpaca Mac (192.168.1.74), exposed via Cloudflare Tunnel at files.alpacaplayhouse.com.

Endpoints:
    POST /photo-search         — Semantic search using SigLIP 2 embeddings
    GET  /photo-exif/<file_id> — EXIF metadata for a photo
    GET  /thumbnail/<file_id>  — Thumbnail (300px)
    GET  /preview/<file_id>    — Full-resolution preview
    GET  /health               — Health check with system status
    GET  /status               — Detailed indexing status
"""

import io
import os
import sqlite3
import struct
import sys
import time
from functools import wraps

import numpy as np
from flask import Flask, g, jsonify, request, send_file
from flask_cors import CORS
from PIL import Image

from logging_config import get_logger, log_with_data

logger = get_logger("api")

DB_PATH = os.path.expanduser("~/file-search-api/file_index.db")
THUMBNAIL_SIZE = (300, 300)
ALLOWED_ORIGINS = [
    "https://finleg.net",
    "https://www.finleg.net",
    "http://localhost:3000",
    "http://localhost:5173",
]

app = Flask(__name__)
CORS(app, origins=ALLOWED_ORIGINS)

# ---------------------------------------------------------------------------
# Request logging middleware
# ---------------------------------------------------------------------------

@app.before_request
def log_request_start():
    """Log every incoming request with method, path, and origin."""
    g.request_start = time.time()
    g.request_id = f"{time.time():.6f}"
    origin = request.headers.get("Origin", "unknown")
    logger.info(
        "REQUEST START [%s] %s %s origin=%s ip=%s",
        g.request_id, request.method, request.path, origin, request.remote_addr,
    )


@app.after_request
def log_request_end(response):
    """Log response status and timing."""
    elapsed = (time.time() - g.request_start) * 1000  # ms
    logger.info(
        "REQUEST END [%s] %s %s status=%d time=%.0fms size=%s",
        g.get("request_id", "?"), request.method, request.path,
        response.status_code, elapsed,
        response.content_length or "streamed",
    )
    return response


@app.errorhandler(Exception)
def handle_error(e):
    """Log all unhandled exceptions."""
    elapsed = (time.time() - g.get("request_start", time.time())) * 1000
    logger.error(
        "REQUEST ERROR [%s] %s %s error=%s time=%.0fms",
        g.get("request_id", "?"), request.method, request.path,
        str(e), elapsed,
        exc_info=True,
    )
    return jsonify({"error": "Internal server error"}), 500


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def get_db() -> sqlite3.Connection:
    """Get database connection (one per request)."""
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop("db", None)
    if db is not None:
        db.close()


# ---------------------------------------------------------------------------
# Model loading (lazy, singleton)
# ---------------------------------------------------------------------------

_model_cache = {}


def get_search_model():
    """Lazy-load SigLIP 2 model for text encoding."""
    if "search" not in _model_cache:
        logger.info("Loading SigLIP 2 model for search (first request)...")
        start = time.time()

        import open_clip
        import torch

        device = "mps" if torch.backends.mps.is_available() else "cpu"
        model, _, preprocess = open_clip.create_model_and_transforms(
            "ViT-B-16-SigLIP2", pretrained="webli"
        )
        model = model.to(device).eval()
        tokenizer = open_clip.get_tokenizer("ViT-B-16-SigLIP2")

        _model_cache["search"] = {
            "model": model,
            "tokenizer": tokenizer,
            "device": device,
        }
        elapsed = time.time() - start
        logger.info("SigLIP 2 model loaded in %.1fs, device=%s", elapsed, device)

    return _model_cache["search"]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.route("/health", methods=["GET"])
def health():
    """Health check with basic system info."""
    try:
        db = get_db()
        total_files = db.execute("SELECT COUNT(*) FROM files").fetchone()[0]
        logger.debug("Health check: ok, total_files=%d", total_files)
        return jsonify({
            "status": "ok",
            "total_files": total_files,
            "model_loaded": "search" in _model_cache,
        })
    except Exception as e:
        logger.error("Health check failed: %s", str(e))
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/status", methods=["GET"])
def status():
    """Detailed indexing status for all pipelines."""
    logger.info("Status check requested")
    db = get_db()

    total_photos = db.execute("SELECT COUNT(*) FROM files WHERE ext IN ('jpg','jpeg','png','heic','webp','gif','bmp','tiff','tif')").fetchone()[0]
    total_files = db.execute("SELECT COUNT(*) FROM files").fetchone()[0]

    result = {
        "total_files": total_files,
        "total_photos": total_photos,
        "pipelines": {},
    }

    # Embeddings
    try:
        embedded = db.execute("SELECT COUNT(*) FROM embeddings").fetchone()[0]
        last_embed = db.execute("SELECT MAX(created_at) FROM embeddings").fetchone()[0]
        result["pipelines"]["embeddings"] = {
            "completed": embedded,
            "remaining": total_photos - embedded,
            "progress_pct": round(embedded / total_photos * 100, 1) if total_photos > 0 else 0,
            "last_updated": last_embed,
        }
    except sqlite3.OperationalError:
        result["pipelines"]["embeddings"] = {"status": "not_started"}

    # Captions
    try:
        captioned = db.execute("SELECT COUNT(*) FROM captions").fetchone()[0]
        last_caption = db.execute("SELECT MAX(created_at) FROM captions").fetchone()[0]
        result["pipelines"]["captions"] = {
            "completed": captioned,
            "remaining": total_photos - captioned,
            "progress_pct": round(captioned / total_photos * 100, 1) if total_photos > 0 else 0,
            "last_updated": last_caption,
        }
    except sqlite3.OperationalError:
        result["pipelines"]["captions"] = {"status": "not_started"}

    # Faces
    try:
        face_indexed = db.execute("SELECT COUNT(*) FROM face_indexed_files").fetchone()[0]
        total_faces = db.execute("SELECT COUNT(*) FROM faces").fetchone()[0]
        n_clusters = db.execute("SELECT COUNT(*) FROM face_clusters").fetchone()[0]
        result["pipelines"]["faces"] = {
            "completed": face_indexed,
            "remaining": total_photos - face_indexed,
            "progress_pct": round(face_indexed / total_photos * 100, 1) if total_photos > 0 else 0,
            "total_faces": total_faces,
            "clusters": n_clusters,
        }
    except sqlite3.OperationalError:
        result["pipelines"]["faces"] = {"status": "not_started"}

    logger.info("Status response: %s", result)
    return jsonify(result)


@app.route("/photo-search", methods=["POST"])
def photo_search():
    """
    Semantic photo search using SigLIP 2 text embeddings.
    Body: { "query": "sunset on the beach", "limit": 20 }
    """
    data = request.get_json()
    query = data.get("query", "").strip()
    limit = min(data.get("limit", 20), 100)

    if not query:
        logger.warning("Empty search query received")
        return jsonify({"error": "Query is required"}), 400

    logger.info("Photo search: query=%r, limit=%d", query, limit)
    search_start = time.time()

    # Encode text query
    model_data = get_search_model()
    import torch

    tokenizer = model_data["tokenizer"]
    model = model_data["model"]
    device = model_data["device"]

    tokens = tokenizer([query]).to(device)
    with torch.no_grad():
        text_embedding = model.encode_text(tokens)
        text_embedding = text_embedding / text_embedding.norm(dim=-1, keepdim=True)
        text_embedding = text_embedding.cpu().numpy().astype(np.float32)[0]

    encode_time = time.time() - search_start
    logger.debug("Text encoded in %.3fs, embedding_dim=%d", encode_time, len(text_embedding))

    # Search against all photo embeddings
    db = get_db()
    rows = db.execute("""
        SELECT e.file_id, e.embedding, f.path, f.name, f.ext, f.size, f.modified
        FROM embeddings e
        JOIN files f ON e.file_id = f.id
    """).fetchall()

    logger.debug("Loaded %d embeddings for comparison", len(rows))
    compare_start = time.time()

    scores = []
    for row in rows:
        emb = np.frombuffer(row["embedding"], dtype=np.float32)
        similarity = float(np.dot(text_embedding, emb))
        scores.append((similarity, row))

    scores.sort(key=lambda x: x[0], reverse=True)
    top_results = scores[:limit]
    compare_time = time.time() - compare_start

    results = []
    for score, row in top_results:
        results.append({
            "file_id": row["file_id"],
            "name": row["name"],
            "score": round(score, 4),
            "path": row["path"],
            "ext": row["ext"],
            "size": row["size"],
            "modified": row["modified"],
        })

    total_time = time.time() - search_start
    logger.info(
        "Photo search complete: query=%r, results=%d, top_score=%.4f, "
        "encode_time=%.3fs, compare_time=%.3fs, total_time=%.3fs, embeddings_searched=%d",
        query, len(results),
        results[0]["score"] if results else 0,
        encode_time, compare_time, total_time, len(rows),
    )

    return jsonify({
        "query": query,
        "results": results,
        "timing": {
            "encode_ms": round(encode_time * 1000),
            "compare_ms": round(compare_time * 1000),
            "total_ms": round(total_time * 1000),
        },
    })


@app.route("/photo-exif/<int:file_id>", methods=["GET"])
def photo_exif(file_id: int):
    """Get EXIF metadata for a photo."""
    logger.info("EXIF request: file_id=%d", file_id)

    db = get_db()
    row = db.execute("SELECT path FROM files WHERE id = ?", (file_id,)).fetchone()
    if not row:
        logger.warning("EXIF: file_id=%d not found", file_id)
        return jsonify({"error": "File not found"}), 404

    path = row["path"]
    if not os.path.exists(path):
        logger.error("EXIF: file_id=%d path does not exist: %s", file_id, path)
        return jsonify({"error": "File not found on disk"}), 404

    try:
        from PIL.ExifTags import TAGS
        img = Image.open(path)
        exif_data = img.getexif()

        exif = {}
        for tag_id, value in exif_data.items():
            tag = TAGS.get(tag_id, tag_id)
            try:
                exif[str(tag)] = str(value)
            except Exception:
                exif[str(tag)] = repr(value)

        logger.info("EXIF: file_id=%d, tags=%d", file_id, len(exif))
        return jsonify({"file_id": file_id, "exif": exif})

    except Exception as e:
        logger.error("EXIF extraction failed: file_id=%d, error=%s", file_id, str(e))
        return jsonify({"error": str(e)}), 500


@app.route("/thumbnail/<int:file_id>", methods=["GET"])
def thumbnail(file_id: int):
    """Generate and serve a 300px thumbnail."""
    logger.debug("Thumbnail request: file_id=%d", file_id)

    db = get_db()
    row = db.execute("SELECT path, ext FROM files WHERE id = ?", (file_id,)).fetchone()
    if not row:
        logger.warning("Thumbnail: file_id=%d not found", file_id)
        return jsonify({"error": "File not found"}), 404

    path = row["path"]
    if not os.path.exists(path):
        logger.error("Thumbnail: file_id=%d path does not exist: %s", file_id, path)
        return jsonify({"error": "File not found on disk"}), 404

    try:
        start = time.time()
        img = Image.open(path)
        img.thumbnail(THUMBNAIL_SIZE)

        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=80)
        buf.seek(0)

        elapsed = (time.time() - start) * 1000
        logger.debug("Thumbnail generated: file_id=%d, size=%dx%d, time=%.0fms",
                      file_id, img.width, img.height, elapsed)

        return send_file(buf, mimetype="image/jpeg")

    except Exception as e:
        logger.error("Thumbnail failed: file_id=%d, error=%s", file_id, str(e))
        return jsonify({"error": str(e)}), 500


@app.route("/preview/<int:file_id>", methods=["GET"])
def preview(file_id: int):
    """Serve full-resolution photo."""
    logger.debug("Preview request: file_id=%d", file_id)

    db = get_db()
    row = db.execute("SELECT path, ext FROM files WHERE id = ?", (file_id,)).fetchone()
    if not row:
        logger.warning("Preview: file_id=%d not found", file_id)
        return jsonify({"error": "File not found"}), 404

    path = row["path"]
    if not os.path.exists(path):
        logger.error("Preview: file_id=%d path does not exist: %s", file_id, path)
        return jsonify({"error": "File not found on disk"}), 404

    ext = row["ext"].lower()
    mime_map = {
        "jpg": "image/jpeg", "jpeg": "image/jpeg",
        "png": "image/png", "gif": "image/gif",
        "webp": "image/webp", "heic": "image/heic",
        "bmp": "image/bmp", "tiff": "image/tiff", "tif": "image/tiff",
    }

    logger.info("Preview served: file_id=%d, ext=%s", file_id, ext)
    return send_file(path, mimetype=mime_map.get(ext, "application/octet-stream"))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    logger.info("=" * 60)
    logger.info("FILE SEARCH API STARTING")
    logger.info("DB: %s", DB_PATH)
    logger.info("Origins: %s", ALLOWED_ORIGINS)
    logger.info("=" * 60)

    # Verify DB access
    try:
        conn = sqlite3.connect(DB_PATH)
        total = conn.execute("SELECT COUNT(*) FROM files").fetchone()[0]
        conn.close()
        logger.info("Database connected: %d files indexed", total)
    except Exception as e:
        logger.error("Database connection failed: %s", str(e))
        sys.exit(1)

    app.run(host="0.0.0.0", port=5001, debug=False)
