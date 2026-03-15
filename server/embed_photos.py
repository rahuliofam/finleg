#!/usr/bin/env python3
"""
Phase 1: SigLIP 2 Embedding Batch Script
Generates 768-dim embeddings for all indexed photos using SigLIP 2 ViT-B.

Usage:
    python embed_photos.py                  # Process all unembedded photos
    python embed_photos.py --batch-size 64  # Custom batch size
    python embed_photos.py --limit 1000     # Process only N photos
    python embed_photos.py --status         # Show progress without processing

Resume-safe: skips already-embedded files on restart.
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

logger = get_logger("embed_photos")

DB_PATH = os.path.expanduser("~/rvault20_index.db")
BATCH_SIZE = 32
MODEL_NAME = "ViT-B-16-SigLIP2"
PRETRAINED = "webli"
EMBEDDING_DIM = 768


def init_db(db_path: str) -> sqlite3.Connection:
    """Initialize DB and create embeddings table if needed."""
    logger.info("Connecting to database: %s", db_path)
    conn = sqlite3.connect(db_path)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS embeddings (
            file_id INTEGER PRIMARY KEY REFERENCES files(id),
            model TEXT NOT NULL DEFAULT 'siglip2-vit-b',
            embedding BLOB NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()

    total_files = conn.execute("SELECT COUNT(*) FROM files WHERE ext IN ('jpg','jpeg','png','heic','webp','gif','bmp','tiff','tif')").fetchone()[0]
    embedded = conn.execute("SELECT COUNT(*) FROM embeddings").fetchone()[0]
    remaining = total_files - embedded
    logger.info("Database status: total_photos=%d, embedded=%d, remaining=%d, progress=%.1f%%",
                total_files, embedded, remaining,
                (embedded / total_files * 100) if total_files > 0 else 0)
    return conn


def load_model():
    """Load SigLIP 2 model and preprocessing."""
    logger.info("Loading SigLIP 2 model: %s (pretrained=%s)", MODEL_NAME, PRETRAINED)
    start = time.time()

    import open_clip
    import torch

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    logger.info("Using device: %s", device)

    model, _, preprocess = open_clip.create_model_and_transforms(
        MODEL_NAME, pretrained=PRETRAINED
    )
    model = model.to(device).eval()
    tokenizer = open_clip.get_tokenizer(MODEL_NAME)

    elapsed = time.time() - start
    logger.info("Model loaded in %.1fs, device=%s", elapsed, device)
    return model, preprocess, tokenizer, device


def get_unembedded_photos(conn: sqlite3.Connection, limit: int = 0) -> list:
    """Get list of photos that haven't been embedded yet."""
    query = """
        SELECT f.id, f.path
        FROM files f
        LEFT JOIN embeddings e ON f.id = e.file_id
        WHERE f.ext IN ('jpg','jpeg','png','heic','webp','gif','bmp','tiff','tif')
          AND e.file_id IS NULL
        ORDER BY f.id
    """
    if limit > 0:
        query += f" LIMIT {limit}"

    photos = conn.execute(query).fetchall()
    logger.info("Found %d unembedded photos to process", len(photos))
    return photos


def process_batch(model, preprocess, device, batch_paths: list) -> list:
    """Process a batch of images and return embeddings."""
    import torch

    images = []
    valid_indices = []

    for i, (file_id, path) in enumerate(batch_paths):
        try:
            img = Image.open(path).convert("RGB")
            img_tensor = preprocess(img)
            images.append(img_tensor)
            valid_indices.append(i)
        except Exception as e:
            logger.warning("Failed to load image file_id=%d path=%s: %s", file_id, path, str(e))

    if not images:
        return []

    batch_tensor = torch.stack(images).to(device)

    with torch.no_grad():
        embeddings = model.encode_image(batch_tensor)
        embeddings = embeddings / embeddings.norm(dim=-1, keepdim=True)
        embeddings = embeddings.cpu().numpy().astype(np.float32)

    results = []
    for idx, emb in zip(valid_indices, embeddings):
        file_id = batch_paths[idx][0]
        results.append((file_id, emb.tobytes()))

    return results


def save_embeddings(conn: sqlite3.Connection, results: list):
    """Save batch of embeddings to database."""
    conn.executemany(
        "INSERT OR IGNORE INTO embeddings (file_id, model, embedding) VALUES (?, 'siglip2-vit-b', ?)",
        results,
    )
    conn.commit()


def show_status(db_path: str):
    """Display current embedding progress."""
    conn = sqlite3.connect(db_path)
    total = conn.execute("SELECT COUNT(*) FROM files WHERE ext IN ('jpg','jpeg','png','heic','webp','gif','bmp','tiff','tif')").fetchone()[0]
    embedded = conn.execute("SELECT COUNT(*) FROM embeddings").fetchone()[0]
    remaining = total - embedded

    last_embed = conn.execute("SELECT MAX(created_at) FROM embeddings").fetchone()[0]
    conn.close()

    logger.info("=== Embedding Status ===")
    logger.info("Total photos:    %d", total)
    logger.info("Embedded:        %d (%.1f%%)", embedded, (embedded / total * 100) if total > 0 else 0)
    logger.info("Remaining:       %d", remaining)
    logger.info("Last embedded:   %s", last_embed or "N/A")

    if embedded > 0 and remaining > 0:
        # Estimate time remaining (assume ~50ms per photo)
        est_seconds = remaining * 0.05
        est_hours = est_seconds / 3600
        logger.info("Est. remaining:  %.1f hours (at ~50ms/photo)", est_hours)


def main():
    parser = argparse.ArgumentParser(description="Generate SigLIP 2 embeddings for photos")
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE, help="Batch size (default: 32)")
    parser.add_argument("--limit", type=int, default=0, help="Max photos to process (0=all)")
    parser.add_argument("--status", action="store_true", help="Show progress and exit")
    parser.add_argument("--db", default=DB_PATH, help="Path to SQLite database")
    args = parser.parse_args()

    if args.status:
        show_status(args.db)
        return

    logger.info("=" * 60)
    logger.info("STARTING EMBEDDING JOB")
    logger.info("batch_size=%d, limit=%d, db=%s", args.batch_size, args.limit, args.db)
    logger.info("=" * 60)

    conn = init_db(args.db)
    photos = get_unembedded_photos(conn, args.limit)

    if not photos:
        logger.info("All photos already embedded. Nothing to do.")
        conn.close()
        return

    model, preprocess, tokenizer, device = load_model()

    total_to_process = len(photos)
    processed = 0
    errors = 0
    start_time = time.time()

    for batch_start in range(0, total_to_process, args.batch_size):
        batch = photos[batch_start : batch_start + args.batch_size]
        batch_num = batch_start // args.batch_size + 1
        total_batches = (total_to_process + args.batch_size - 1) // args.batch_size

        batch_start_time = time.time()
        results = process_batch(model, preprocess, device, batch)
        batch_elapsed = time.time() - batch_start_time

        save_embeddings(conn, results)

        batch_errors = len(batch) - len(results)
        processed += len(results)
        errors += batch_errors

        elapsed_total = time.time() - start_time
        rate = processed / elapsed_total if elapsed_total > 0 else 0
        remaining = total_to_process - (batch_start + len(batch))
        eta_seconds = remaining / rate if rate > 0 else 0
        eta_hours = eta_seconds / 3600

        logger.info(
            "Batch %d/%d: embedded=%d, errors=%d, batch_time=%.1fs, "
            "total_processed=%d/%d (%.1f%%), rate=%.0f/s, ETA=%.1fh",
            batch_num, total_batches, len(results), batch_errors, batch_elapsed,
            processed, total_to_process, processed / total_to_process * 100,
            rate, eta_hours,
        )

        # Periodic detailed status every 100 batches
        if batch_num % 100 == 0:
            logger.info(
                "--- CHECKPOINT: processed=%d, errors=%d, elapsed=%.0fs, rate=%.1f photos/sec ---",
                processed, errors, elapsed_total, rate,
            )

    total_elapsed = time.time() - start_time
    logger.info("=" * 60)
    logger.info("EMBEDDING JOB COMPLETE")
    logger.info("Total processed: %d", processed)
    logger.info("Total errors:    %d", errors)
    logger.info("Total time:      %.1f minutes (%.1f hours)", total_elapsed / 60, total_elapsed / 3600)
    logger.info("Average rate:    %.1f photos/sec", processed / total_elapsed if total_elapsed > 0 else 0)
    logger.info("=" * 60)

    conn.close()


if __name__ == "__main__":
    main()
