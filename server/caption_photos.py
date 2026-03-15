#!/usr/bin/env python3
"""
Phase 3: Moondream 2 Caption Batch Script
Generates natural language captions for all indexed photos.

Usage:
    python caption_photos.py                 # Process all uncaptioned photos
    python caption_photos.py --limit 500     # Process only N photos
    python caption_photos.py --status        # Show progress without processing

Resume-safe: skips already-captioned files on restart.
~1.5 seconds per photo, ~3.5 days for 200K photos.
"""

import argparse
import os
import sqlite3
import sys
import time
from pathlib import Path

from PIL import Image

from logging_config import get_logger

logger = get_logger("caption_photos")

DB_PATH = os.path.expanduser("~/file-search-api/file_index.db")
CAPTION_PROMPT = "Describe this photo in detail including people, activities, setting, colors, objects, and any text visible."


def init_db(db_path: str) -> sqlite3.Connection:
    """Initialize DB and create captions tables if needed."""
    logger.info("Connecting to database: %s", db_path)
    conn = sqlite3.connect(db_path)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS captions (
            file_id INTEGER PRIMARY KEY REFERENCES files(id),
            model TEXT NOT NULL DEFAULT 'moondream2',
            caption TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS captions_fts
        USING fts5(caption, content=captions, content_rowid=file_id)
    """)
    conn.commit()

    total_photos = conn.execute("SELECT COUNT(*) FROM files WHERE ext IN ('jpg','jpeg','png','heic','webp','gif','bmp','tiff','tif')").fetchone()[0]
    captioned = conn.execute("SELECT COUNT(*) FROM captions").fetchone()[0]
    remaining = total_photos - captioned
    logger.info("Database status: total_photos=%d, captioned=%d, remaining=%d, progress=%.1f%%",
                total_photos, captioned, remaining,
                (captioned / total_photos * 100) if total_photos > 0 else 0)
    return conn


def load_model():
    """Load Moondream 2 model."""
    logger.info("Loading Moondream 2 model...")
    start = time.time()

    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    logger.info("Using device: %s", device)

    model = AutoModelForCausalLM.from_pretrained(
        "vikhyatk/moondream2",
        trust_remote_code=True,
        torch_dtype=torch.float16 if device == "mps" else torch.float32,
    ).to(device)
    tokenizer = AutoTokenizer.from_pretrained("vikhyatk/moondream2")

    elapsed = time.time() - start
    logger.info("Moondream 2 loaded in %.1fs, device=%s", elapsed, device)
    return model, tokenizer, device


def get_uncaptioned_photos(conn: sqlite3.Connection, limit: int = 0) -> list:
    """Get list of photos that haven't been captioned yet."""
    query = """
        SELECT f.id, f.path
        FROM files f
        LEFT JOIN captions c ON f.id = c.file_id
        WHERE f.ext IN ('jpg','jpeg','png','heic','webp','gif','bmp','tiff','tif')
          AND c.file_id IS NULL
        ORDER BY f.id
    """
    if limit > 0:
        query += f" LIMIT {limit}"

    photos = conn.execute(query).fetchall()
    logger.info("Found %d uncaptioned photos to process", len(photos))
    return photos


def caption_photo(model, tokenizer, path: str) -> str:
    """Generate a caption for a single photo."""
    img = Image.open(path).convert("RGB")
    enc_image = model.encode_image(img)
    caption = model.answer_question(enc_image, CAPTION_PROMPT, tokenizer)
    return caption.strip()


def save_caption(conn: sqlite3.Connection, file_id: int, caption: str):
    """Save caption and update FTS index."""
    conn.execute(
        "INSERT OR REPLACE INTO captions (file_id, model, caption) VALUES (?, 'moondream2', ?)",
        (file_id, caption),
    )
    conn.execute(
        "INSERT OR REPLACE INTO captions_fts (rowid, caption) VALUES (?, ?)",
        (file_id, caption),
    )
    conn.commit()


def show_status(db_path: str):
    """Display current captioning progress."""
    conn = sqlite3.connect(db_path)
    total = conn.execute("SELECT COUNT(*) FROM files WHERE ext IN ('jpg','jpeg','png','heic','webp','gif','bmp','tiff','tif')").fetchone()[0]

    try:
        captioned = conn.execute("SELECT COUNT(*) FROM captions").fetchone()[0]
        last_caption = conn.execute("SELECT MAX(created_at) FROM captions").fetchone()[0]
    except sqlite3.OperationalError:
        captioned = 0
        last_caption = None

    remaining = total - captioned
    conn.close()

    logger.info("=== Caption Status ===")
    logger.info("Total photos:    %d", total)
    logger.info("Captioned:       %d (%.1f%%)", captioned, (captioned / total * 100) if total > 0 else 0)
    logger.info("Remaining:       %d", remaining)
    logger.info("Last captioned:  %s", last_caption or "N/A")

    if captioned > 0 and remaining > 0:
        est_seconds = remaining * 1.5
        est_hours = est_seconds / 3600
        logger.info("Est. remaining:  %.1f hours (%.1f days at ~1.5s/photo)", est_hours, est_hours / 24)


def main():
    parser = argparse.ArgumentParser(description="Generate Moondream 2 captions for photos")
    parser.add_argument("--limit", type=int, default=0, help="Max photos to process (0=all)")
    parser.add_argument("--status", action="store_true", help="Show progress and exit")
    parser.add_argument("--db", default=DB_PATH, help="Path to SQLite database")
    args = parser.parse_args()

    if args.status:
        show_status(args.db)
        return

    logger.info("=" * 60)
    logger.info("STARTING CAPTION JOB")
    logger.info("limit=%d, db=%s", args.limit, args.db)
    logger.info("=" * 60)

    conn = init_db(args.db)
    photos = get_uncaptioned_photos(conn, args.limit)

    if not photos:
        logger.info("All photos already captioned. Nothing to do.")
        conn.close()
        return

    model, tokenizer, device = load_model()

    total_to_process = len(photos)
    processed = 0
    errors = 0
    start_time = time.time()

    for i, (file_id, path) in enumerate(photos):
        photo_start = time.time()
        try:
            caption = caption_photo(model, tokenizer, path)
            save_caption(conn, file_id, caption)
            photo_elapsed = time.time() - photo_start
            processed += 1

            # Log every photo (they're slow enough that this is fine)
            if (i + 1) % 10 == 0 or i == 0:
                elapsed_total = time.time() - start_time
                rate = processed / elapsed_total if elapsed_total > 0 else 0
                remaining = total_to_process - (i + 1)
                eta_seconds = remaining / rate if rate > 0 else 0
                eta_hours = eta_seconds / 3600

                logger.info(
                    "Photo %d/%d: file_id=%d, time=%.1fs, caption_len=%d, "
                    "total_processed=%d, rate=%.2f/s, ETA=%.1fh",
                    i + 1, total_to_process, file_id, photo_elapsed, len(caption),
                    processed, rate, eta_hours,
                )
            else:
                logger.debug(
                    "Photo %d/%d: file_id=%d, time=%.1fs, caption_len=%d",
                    i + 1, total_to_process, file_id, photo_elapsed, len(caption),
                )

        except Exception as e:
            errors += 1
            logger.error(
                "Failed to caption file_id=%d path=%s: %s",
                file_id, path, str(e),
            )

        # Checkpoint every 100 photos
        if (i + 1) % 100 == 0:
            elapsed_total = time.time() - start_time
            logger.info(
                "--- CHECKPOINT: processed=%d, errors=%d, elapsed=%.0fm, rate=%.2f photos/sec ---",
                processed, errors, elapsed_total / 60, processed / elapsed_total,
            )

    total_elapsed = time.time() - start_time
    logger.info("=" * 60)
    logger.info("CAPTION JOB COMPLETE")
    logger.info("Total processed: %d", processed)
    logger.info("Total errors:    %d", errors)
    logger.info("Total time:      %.1f hours (%.1f days)", total_elapsed / 3600, total_elapsed / 86400)
    logger.info("Average rate:    %.2f photos/sec (%.1fs/photo)",
                processed / total_elapsed if total_elapsed > 0 else 0,
                total_elapsed / processed if processed > 0 else 0)
    logger.info("=" * 60)

    conn.close()


if __name__ == "__main__":
    main()
