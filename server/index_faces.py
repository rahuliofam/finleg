#!/usr/bin/env python3
"""
Phase 4: Face Indexing Script
Detects faces in photos, generates face embeddings, and clusters them for
"who is in this photo?" queries.

Usage:
    python index_faces.py                  # Process all unindexed photos
    python index_faces.py --limit 1000     # Process only N photos
    python index_faces.py --status         # Show progress without processing
    python index_faces.py --cluster        # Run clustering on existing embeddings

Resume-safe: skips already-indexed files on restart.
"""

import argparse
import os
import sqlite3
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

from logging_config import get_logger

logger = get_logger("index_faces")

DB_PATH = os.path.expanduser("~/file-search-api/file_index.db")


def init_db(db_path: str) -> sqlite3.Connection:
    """Initialize DB and create face tables if needed."""
    logger.info("Connecting to database: %s", db_path)
    conn = sqlite3.connect(db_path)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS faces (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER REFERENCES files(id),
            bbox_x REAL NOT NULL,
            bbox_y REAL NOT NULL,
            bbox_w REAL NOT NULL,
            bbox_h REAL NOT NULL,
            confidence REAL NOT NULL,
            embedding BLOB,
            cluster_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS face_clusters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            label TEXT,
            representative_face_id INTEGER REFERENCES faces(id),
            count INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS face_indexed_files (
            file_id INTEGER PRIMARY KEY REFERENCES files(id),
            faces_found INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()

    total_photos = conn.execute("SELECT COUNT(*) FROM files WHERE ext IN ('jpg','jpeg','png','heic','webp','gif','bmp','tiff','tif')").fetchone()[0]
    indexed = conn.execute("SELECT COUNT(*) FROM face_indexed_files").fetchone()[0]
    total_faces = conn.execute("SELECT COUNT(*) FROM faces").fetchone()[0]
    remaining = total_photos - indexed

    logger.info("Database status: total_photos=%d, face_indexed=%d, remaining=%d, total_faces_found=%d, progress=%.1f%%",
                total_photos, indexed, remaining, total_faces,
                (indexed / total_photos * 100) if total_photos > 0 else 0)
    return conn


def load_detector():
    """Load face detection model (RetinaFace or MTCNN)."""
    logger.info("Loading face detection model...")
    start = time.time()

    try:
        from insightface.app import FaceAnalysis
        app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
        app.prepare(ctx_id=0, det_size=(640, 640))
        elapsed = time.time() - start
        logger.info("InsightFace (buffalo_l) loaded in %.1fs", elapsed)
        return app, "insightface"
    except ImportError:
        logger.warning("InsightFace not available, falling back to MTCNN")

    from facenet_pytorch import MTCNN, InceptionResnetV1
    import torch

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    mtcnn = MTCNN(keep_all=True, device=device, min_face_size=40)
    resnet = InceptionResnetV1(pretrained="vggface2").eval().to(device)

    elapsed = time.time() - start
    logger.info("MTCNN + InceptionResnetV1 loaded in %.1fs, device=%s", elapsed, device)
    return (mtcnn, resnet, device), "mtcnn"


def detect_faces_insightface(app, img_path: str) -> list:
    """Detect faces using InsightFace."""
    import cv2
    img = cv2.imread(img_path)
    if img is None:
        raise ValueError(f"Could not read image: {img_path}")

    faces = app.get(img)
    results = []
    h, w = img.shape[:2]

    for face in faces:
        bbox = face.bbox
        results.append({
            "bbox_x": float(bbox[0] / w),
            "bbox_y": float(bbox[1] / h),
            "bbox_w": float((bbox[2] - bbox[0]) / w),
            "bbox_h": float((bbox[3] - bbox[1]) / h),
            "confidence": float(face.det_score),
            "embedding": face.embedding.astype(np.float32).tobytes() if face.embedding is not None else None,
        })

    return results


def detect_faces_mtcnn(models, img_path: str) -> list:
    """Detect faces using MTCNN + InceptionResnetV1."""
    import torch

    mtcnn, resnet, device = models
    img = Image.open(img_path).convert("RGB")
    boxes, probs, landmarks = mtcnn.detect(img, landmarks=True)

    if boxes is None:
        return []

    results = []
    w, h = img.size

    # Get face crops for embedding
    faces_cropped = mtcnn(img)

    for i, (box, prob) in enumerate(zip(boxes, probs)):
        embedding = None
        if faces_cropped is not None and i < len(faces_cropped) and faces_cropped[i] is not None:
            with torch.no_grad():
                face_tensor = faces_cropped[i].unsqueeze(0).to(device)
                emb = resnet(face_tensor).cpu().numpy().astype(np.float32)
                embedding = emb[0].tobytes()

        results.append({
            "bbox_x": float(box[0] / w),
            "bbox_y": float(box[1] / h),
            "bbox_w": float((box[2] - box[0]) / w),
            "bbox_h": float((box[3] - box[1]) / h),
            "confidence": float(prob),
            "embedding": embedding,
        })

    return results


def get_unindexed_photos(conn: sqlite3.Connection, limit: int = 0) -> list:
    """Get list of photos not yet processed for face detection."""
    query = """
        SELECT f.id, f.path
        FROM files f
        LEFT JOIN face_indexed_files fi ON f.id = fi.file_id
        WHERE f.ext IN ('jpg','jpeg','png','heic','webp','gif','bmp','tiff','tif')
          AND fi.file_id IS NULL
        ORDER BY f.id
    """
    if limit > 0:
        query += f" LIMIT {limit}"

    photos = conn.execute(query).fetchall()
    logger.info("Found %d photos to index for faces", len(photos))
    return photos


def save_faces(conn: sqlite3.Connection, file_id: int, faces: list):
    """Save detected faces and mark file as indexed."""
    for face in faces:
        conn.execute(
            "INSERT INTO faces (file_id, bbox_x, bbox_y, bbox_w, bbox_h, confidence, embedding) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (file_id, face["bbox_x"], face["bbox_y"], face["bbox_w"], face["bbox_h"],
             face["confidence"], face["embedding"]),
        )

    conn.execute(
        "INSERT OR REPLACE INTO face_indexed_files (file_id, faces_found) VALUES (?, ?)",
        (file_id, len(faces)),
    )
    conn.commit()


def run_clustering(conn: sqlite3.Connection, min_cluster_size: int = 5):
    """Cluster face embeddings using HDBSCAN."""
    logger.info("Starting face clustering...")
    start = time.time()

    from sklearn.cluster import HDBSCAN

    rows = conn.execute("SELECT id, embedding FROM faces WHERE embedding IS NOT NULL").fetchall()
    logger.info("Loaded %d face embeddings for clustering", len(rows))

    if len(rows) < min_cluster_size:
        logger.warning("Not enough faces for clustering (need >= %d, have %d)", min_cluster_size, len(rows))
        return

    face_ids = [r[0] for r in rows]
    embeddings = np.array([np.frombuffer(r[1], dtype=np.float32) for r in rows])

    # Normalize embeddings
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    embeddings = embeddings / norms

    logger.info("Running HDBSCAN clustering (min_cluster_size=%d)...", min_cluster_size)
    clusterer = HDBSCAN(min_cluster_size=min_cluster_size, metric="cosine")
    labels = clusterer.fit_predict(embeddings)

    n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
    n_noise = list(labels).count(-1)
    logger.info("Clustering complete: %d clusters found, %d noise points (%.1f%%)",
                n_clusters, n_noise, n_noise / len(labels) * 100)

    # Clear old clusters
    conn.execute("DELETE FROM face_clusters")
    conn.execute("UPDATE faces SET cluster_id = NULL")

    # Save new clusters
    for cluster_id in set(labels):
        if cluster_id == -1:
            continue
        mask = labels == cluster_id
        cluster_face_ids = [face_ids[i] for i in range(len(face_ids)) if mask[i]]
        count = len(cluster_face_ids)

        conn.execute(
            "INSERT INTO face_clusters (id, count) VALUES (?, ?)",
            (int(cluster_id), count),
        )
        for fid in cluster_face_ids:
            conn.execute("UPDATE faces SET cluster_id = ? WHERE id = ?", (int(cluster_id), fid))

        logger.debug("Cluster %d: %d faces", cluster_id, count)

    conn.commit()
    elapsed = time.time() - start
    logger.info("Clustering saved in %.1fs: %d clusters, largest=%d faces",
                elapsed, n_clusters,
                max((list(labels).count(l) for l in set(labels) if l != -1), default=0))


def show_status(db_path: str):
    """Display current face indexing progress."""
    conn = sqlite3.connect(db_path)
    total = conn.execute("SELECT COUNT(*) FROM files WHERE ext IN ('jpg','jpeg','png','heic','webp','gif','bmp','tiff','tif')").fetchone()[0]

    try:
        indexed = conn.execute("SELECT COUNT(*) FROM face_indexed_files").fetchone()[0]
        total_faces = conn.execute("SELECT COUNT(*) FROM faces").fetchone()[0]
        with_faces = conn.execute("SELECT COUNT(*) FROM face_indexed_files WHERE faces_found > 0").fetchone()[0]
        last_indexed = conn.execute("SELECT MAX(created_at) FROM face_indexed_files").fetchone()[0]
        n_clusters = conn.execute("SELECT COUNT(*) FROM face_clusters").fetchone()[0]
    except sqlite3.OperationalError:
        indexed = total_faces = with_faces = n_clusters = 0
        last_indexed = None

    remaining = total - indexed
    conn.close()

    logger.info("=== Face Index Status ===")
    logger.info("Total photos:       %d", total)
    logger.info("Face-indexed:       %d (%.1f%%)", indexed, (indexed / total * 100) if total > 0 else 0)
    logger.info("Photos with faces:  %d (%.1f%% of indexed)", with_faces, (with_faces / indexed * 100) if indexed > 0 else 0)
    logger.info("Total faces found:  %d", total_faces)
    logger.info("Face clusters:      %d", n_clusters)
    logger.info("Remaining:          %d", remaining)
    logger.info("Last indexed:       %s", last_indexed or "N/A")


def main():
    parser = argparse.ArgumentParser(description="Detect and index faces in photos")
    parser.add_argument("--limit", type=int, default=0, help="Max photos to process (0=all)")
    parser.add_argument("--status", action="store_true", help="Show progress and exit")
    parser.add_argument("--cluster", action="store_true", help="Run clustering on existing embeddings")
    parser.add_argument("--db", default=DB_PATH, help="Path to SQLite database")
    args = parser.parse_args()

    if args.status:
        show_status(args.db)
        return

    if args.cluster:
        conn = sqlite3.connect(args.db)
        run_clustering(conn)
        conn.close()
        return

    logger.info("=" * 60)
    logger.info("STARTING FACE INDEXING JOB")
    logger.info("limit=%d, db=%s", args.limit, args.db)
    logger.info("=" * 60)

    conn = init_db(args.db)
    photos = get_unindexed_photos(conn, args.limit)

    if not photos:
        logger.info("All photos already face-indexed. Nothing to do.")
        conn.close()
        return

    detector, detector_type = load_detector()
    logger.info("Using detector: %s", detector_type)

    total_to_process = len(photos)
    processed = 0
    errors = 0
    total_faces_found = 0
    start_time = time.time()

    for i, (file_id, path) in enumerate(photos):
        photo_start = time.time()
        try:
            if detector_type == "insightface":
                faces = detect_faces_insightface(detector, path)
            else:
                faces = detect_faces_mtcnn(detector, path)

            save_faces(conn, file_id, faces)
            photo_elapsed = time.time() - photo_start
            processed += 1
            total_faces_found += len(faces)

            if len(faces) > 0:
                logger.info(
                    "Photo %d/%d: file_id=%d, faces=%d, confidence=[%s], time=%.2fs",
                    i + 1, total_to_process, file_id, len(faces),
                    ", ".join(f"{f['confidence']:.2f}" for f in faces),
                    photo_elapsed,
                )
            elif (i + 1) % 50 == 0:
                elapsed_total = time.time() - start_time
                rate = processed / elapsed_total if elapsed_total > 0 else 0
                remaining = total_to_process - (i + 1)
                eta_hours = (remaining / rate / 3600) if rate > 0 else 0

                logger.info(
                    "Photo %d/%d: no faces, total_processed=%d, faces_found=%d, rate=%.1f/s, ETA=%.1fh",
                    i + 1, total_to_process, processed, total_faces_found, rate, eta_hours,
                )
            else:
                logger.debug("Photo %d/%d: file_id=%d, no faces, time=%.2fs",
                             i + 1, total_to_process, file_id, photo_elapsed)

        except Exception as e:
            errors += 1
            logger.error("Failed to process file_id=%d path=%s: %s", file_id, path, str(e))

        # Checkpoint every 200 photos
        if (i + 1) % 200 == 0:
            elapsed_total = time.time() - start_time
            logger.info(
                "--- CHECKPOINT: processed=%d, errors=%d, faces_found=%d, elapsed=%.0fm, rate=%.1f/s ---",
                processed, errors, total_faces_found, elapsed_total / 60,
                processed / elapsed_total,
            )

    total_elapsed = time.time() - start_time
    logger.info("=" * 60)
    logger.info("FACE INDEXING JOB COMPLETE")
    logger.info("Total processed:   %d", processed)
    logger.info("Total errors:      %d", errors)
    logger.info("Total faces found: %d", total_faces_found)
    logger.info("Avg faces/photo:   %.2f", total_faces_found / processed if processed > 0 else 0)
    logger.info("Total time:        %.1f minutes (%.1f hours)", total_elapsed / 60, total_elapsed / 3600)
    logger.info("Average rate:      %.1f photos/sec", processed / total_elapsed if total_elapsed > 0 else 0)
    logger.info("=" * 60)

    conn.close()


if __name__ == "__main__":
    main()
