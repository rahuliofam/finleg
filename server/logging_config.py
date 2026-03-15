"""
Shared logging configuration for all file services.
Provides structured, timestamped logs with rotating file handlers.

Usage:
    from logging_config import get_logger
    logger = get_logger("embed_photos")
"""

import logging
import logging.handlers
import os
import sys
import json
from datetime import datetime, timezone

LOG_DIR = os.path.expanduser("~/file-search-api/logs")
os.makedirs(LOG_DIR, exist_ok=True)


class JSONFormatter(logging.Formatter):
    """Structured JSON log formatter for machine-readable logs."""

    def format(self, record):
        log_entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if hasattr(record, "extra_data"):
            log_entry["data"] = record.extra_data
        if record.exc_info and record.exc_info[0]:
            log_entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(log_entry)


class HumanFormatter(logging.Formatter):
    """Human-readable formatter for console output."""

    def format(self, record):
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        level = record.levelname.ljust(7)
        return f"[{ts}] {level} [{record.name}] {record.getMessage()}"


def get_logger(name: str, console_level=logging.INFO) -> logging.Logger:
    """
    Create a logger with both console and rotating file handlers.

    - Console: human-readable, colored output
    - File: JSON-structured, rotating (10MB x 5 backups)
    """
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger  # Already configured

    logger.setLevel(logging.DEBUG)

    # Console handler — human-readable
    console = logging.StreamHandler(sys.stdout)
    console.setLevel(console_level)
    console.setFormatter(HumanFormatter())
    logger.addHandler(console)

    # File handler — JSON structured, rotating
    log_file = os.path.join(LOG_DIR, f"{name}.log")
    file_handler = logging.handlers.RotatingFileHandler(
        log_file, maxBytes=10 * 1024 * 1024, backupCount=5
    )
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(JSONFormatter())
    logger.addHandler(file_handler)

    # Also write errors to a shared error log
    error_file = os.path.join(LOG_DIR, "errors.log")
    error_handler = logging.handlers.RotatingFileHandler(
        error_file, maxBytes=10 * 1024 * 1024, backupCount=3
    )
    error_handler.setLevel(logging.ERROR)
    error_handler.setFormatter(JSONFormatter())
    logger.addHandler(error_handler)

    return logger


def log_with_data(logger, level, message, **kwargs):
    """Log a message with structured extra data."""
    record = logger.makeRecord(
        logger.name, level, "(unknown)", 0, message, (), None
    )
    record.extra_data = kwargs
    logger.handle(record)
