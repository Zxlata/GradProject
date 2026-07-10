"""
Thin wrapper around OpenCV for loading videos and computing the primitive
features used across the video pipeline.

Mirrors :mod:`src.audio_processing.audio_utils`:

- ``validate_video_path``           — path / extension checks
- ``open_video`` (context manager)  — safe ``cv2.VideoCapture`` wrapper
- ``video_info``                    — fps / frame count / duration / resolution
- ``iter_frames``                   — (frame_index, timestamp, BGR frame) generator
- pure-numeric **score helpers** (``face_presence_ratio``, ``eye_contact_score``,
  ``engagement_score``, ``emotion_stability``) that take plain numpy / lists and
  return 0-100 floats — so ``FaceTracker`` and ``EmotionAnalyzer`` stay free of
  scoring math and tests can exercise the scoring logic without a real video.

``cv2`` is imported lazily inside each function that needs it so importing this
module is cheap and unit tests that monkeypatch `cv2` keep working.
"""

from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Optional, Sequence, Tuple

import numpy as np

from src.utils.logger import get_logger

logger = get_logger(__name__)

SUPPORTED_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"}


# --------------------------------------------------------------------------- #
# Validation
# --------------------------------------------------------------------------- #


def validate_video_path(video_path: str | Path) -> Path:
    """Return a validated ``Path`` for an existing supported video file."""
    path = Path(video_path).expanduser().resolve()
    if not path.exists():
        raise FileNotFoundError(f"Video file not found: {path}")
    if not path.is_file():
        raise ValueError(f"Video path is not a file: {path}")
    if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise ValueError(
            f"Unsupported video extension '{path.suffix}'. "
            f"Supported: {sorted(SUPPORTED_EXTENSIONS)}"
        )
    return path


# --------------------------------------------------------------------------- #
# Loading
# --------------------------------------------------------------------------- #


@contextmanager
def open_video(video_path: str | Path):
    """Context-managed ``cv2.VideoCapture`` that is always released.

    Usage::

        with open_video("interview.mp4") as cap:
            ok, frame = cap.read()
    """
    import cv2

    path = validate_video_path(video_path)
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        cap.release()
        raise RuntimeError(f"Cannot open video: {path}")
    try:
        yield cap
    finally:
        cap.release()


def video_info(video_path: str | Path) -> Dict[str, Any]:
    """Return a small summary of a video file.

    Every key is always present and safe to consume — ``fps`` falls back to
    0.0 if the container does not expose it, and ``duration_seconds`` is
    computed defensively from ``frame_count / fps``.
    """
    import cv2

    with open_video(video_path) as cap:
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)

    duration = float(total_frames) / fps if fps > 0 else 0.0

    return {
        "path": str(Path(video_path).expanduser().resolve()),
        "fps": fps,
        "frame_count": total_frames,
        "duration_seconds": duration,
        "width": width,
        "height": height,
    }


def iter_frames(
    video_path: str | Path,
    sample_rate: int = 1,
    max_frames: Optional[int] = None,
) -> Iterator[Tuple[int, float, np.ndarray]]:
    """Yield ``(frame_index, timestamp_seconds, bgr_frame)`` tuples.

    Parameters
    ----------
    sample_rate:
        Only yield every Nth frame. ``sample_rate=1`` yields every frame,
        ``sample_rate=5`` yields frames 0, 5, 10, ... Matches the default
        used by ``EmotionAnalyzer`` (``config.VIDEO_FRAME_SAMPLE_RATE``).
    max_frames:
        Optional hard cap on yielded frames — handy for long recordings.
    """
    if sample_rate < 1:
        raise ValueError(f"sample_rate must be >= 1, got {sample_rate}")

    import cv2

    with open_video(video_path) as cap:
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        frame_index = 0
        yielded = 0

        while True:
            ok, frame = cap.read()
            if not ok:
                break

            if frame_index % sample_rate == 0:
                timestamp = frame_index / fps if fps > 0 else 0.0
                yield frame_index, float(timestamp), frame
                yielded += 1
                if max_frames is not None and yielded >= max_frames:
                    break

            frame_index += 1


def extract_frames(
    video_path: str | Path,
    sample_rate: int = 1,
    max_frames: Optional[int] = None,
) -> List[Tuple[int, float, np.ndarray]]:
    """Eager version of :func:`iter_frames` — materializes the full list."""
    return list(iter_frames(video_path, sample_rate=sample_rate, max_frames=max_frames))


# --------------------------------------------------------------------------- #
# Primitive → score helpers (pure, no OpenCV)
# --------------------------------------------------------------------------- #


def face_presence_ratio(frames_with_face: int, total_frames: int) -> float:
    """Fraction of processed frames that contained at least one face (0-1)."""
    if total_frames <= 0:
        return 0.0
    ratio = float(frames_with_face) / float(total_frames)
    return float(np.clip(ratio, 0.0, 1.0))


def eye_contact_score(
    horizontal_positions: Sequence[float],
    ideal_center: float = 0.5,
) -> float:
    """Estimate eye contact from a sequence of face-center x-coords in [0, 1].

    The closer faces stay to the horizontal center of the frame, the higher
    the score. Returns a 0-1 float — ``ScoringEngine._calculate_video_score``
    auto-detects the 0-1 scale and promotes it to 0-100 internally.

    Parameters
    ----------
    horizontal_positions:
        Face-center x values, each in [0, 1]. Empty input → 0.0.
    ideal_center:
        Where the speaker is expected to look. Defaults to the middle of the
        frame (0.5); exposed so callers can tune for off-center webcams.
    """
    if not horizontal_positions:
        return 0.0

    xs = np.asarray(list(horizontal_positions), dtype=np.float64)
    xs = np.clip(xs, 0.0, 1.0)
    deviations = np.abs(xs - float(ideal_center))
    avg_deviation = float(np.mean(deviations))

    # Mirrors the formula from the guide: deviation of 0 → 1.0, deviation of
    # >=0.5 → 0.0 (face fully to one side).
    score = max(0.0, 1.0 - 2.0 * avg_deviation)
    return float(np.clip(score, 0.0, 1.0))


def engagement_score(
    presence_ratio: float,
    eye_contact: float,
    presence_weight: float = 0.7,
    eye_weight: float = 0.3,
) -> float:
    """Combine face presence (0-1) and eye contact (0-1) into a 0-100 score.

    Matches the formula documented in the guide's ``FaceTracker``::

        engagement = (presence * 0.7 + eye_contact * 0.3) * 100
    """
    total = presence_weight + eye_weight
    if total <= 0:
        return 0.0

    presence = float(np.clip(presence_ratio, 0.0, 1.0))
    eyes = float(np.clip(eye_contact, 0.0, 1.0))
    weighted = (presence * presence_weight + eyes * eye_weight) / total
    return float(np.clip(weighted * 100.0, 0.0, 100.0))


def emotion_stability(labels: Iterable[str]) -> float:
    """How dominant the most-common label is across an emotion timeline (0-100).

    A single repeated emotion → 100.0. Perfectly uniform across K labels
    → ``100/K``. Empty input → 0.0.
    """
    seq = [str(label) for label in (labels or []) if label]
    if not seq:
        return 0.0

    counts: Dict[str, int] = {}
    for label in seq:
        counts[label] = counts.get(label, 0) + 1

    dominant = max(counts.values())
    return float(np.clip((dominant / len(seq)) * 100.0, 0.0, 100.0))


# --------------------------------------------------------------------------- #
# Color helpers (used by FaceTracker / EmotionAnalyzer)
# --------------------------------------------------------------------------- #


def bgr_to_rgb(frame: np.ndarray) -> np.ndarray:
    """Return an RGB copy of an OpenCV BGR frame (no-op for empty arrays)."""
    import cv2

    if frame is None or frame.size == 0:
        return frame
    return cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)


def bgr_to_gray(frame: np.ndarray) -> np.ndarray:
    """Return a grayscale copy of an OpenCV BGR frame."""
    import cv2

    if frame is None or frame.size == 0:
        return frame
    return cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
