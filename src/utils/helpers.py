"""
Shared helper functions.

Small, dependency-free utilities used across modules.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any


def ensure_dir(path: str | Path) -> Path:
    """Create the directory if it doesn't exist and return it as a Path."""
    p = Path(path)
    p.mkdir(parents=True, exist_ok=True)
    return p


def read_json(path: str | Path) -> Any:
    """Read a JSON file and return its contents."""
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: str | Path, data: Any, indent: int = 2) -> None:
    """Write `data` as pretty JSON, creating parent directories as needed."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=indent, ensure_ascii=False)


def timestamp_slug() -> str:
    """Return a filesystem-safe timestamp, e.g. '20260421-194512'."""
    return datetime.now().strftime("%Y%m%d-%H%M%S")


def new_session_id() -> str:
    """Return a short unique id suitable for an interview session."""
    return uuid.uuid4().hex[:12]


def safe_filename(name: str) -> str:
    """Replace characters that are unsafe on Windows/Linux filesystems."""
    bad = '<>:"/\\|?*'
    return "".join("_" if ch in bad else ch for ch in name).strip()


def clamp(value: float, lo: float = 0.0, hi: float = 100.0) -> float:
    """Clamp a numeric value into [lo, hi]."""
    return max(lo, min(hi, value))
