"""
Facial emotion analysis with DeepFace.

Design mirrors :class:`src.audio_processing.emotion_detector.EmotionDetector`:

- **DeepFace-first, brightness fallback.** The primary analyser is
  ``deepface.DeepFace.analyze`` (emotion action). If ``deepface`` can't be
  imported / loaded, we degrade to a tiny brightness+contrast heuristic so
  the rest of the pipeline keeps producing a timeline of the expected
  shape.
- **Injectable ``analyzer_loader``.** Tests pass a fake callable that
  returns an object exposing ``analyze(frame, actions, enforce_detection)``,
  so unit tests never touch the real weights (~200 MB).
- **No scoring math lives here.** ``emotion_summary`` delegates stability
  scoring to :func:`src.video_processing.video_utils.emotion_stability`,
  matching how ``FaceTracker`` delegates its presence/eye/engagement math.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import numpy as np

from src.utils.logger import get_logger
from src.video_processing.video_utils import (
    bgr_to_gray,
    emotion_stability,
    iter_frames,
    validate_video_path,
)

logger = get_logger(__name__)

# Canonical DeepFace label set.
CANONICAL_EMOTIONS = (
    "angry",
    "disgust",
    "fear",
    "happy",
    "sad",
    "surprise",
    "neutral",
)


class EmotionAnalyzer:
    """Analyse facial emotions over a video (DeepFace + brightness fallback)."""

    def __init__(
        self,
        analyzer_loader: Optional[Callable[[], Any]] = None,
    ) -> None:
        self._analyzer_loader = analyzer_loader
        self._analyzer: Any = None
        self._load_error: Optional[str] = None
        self._tried_load = False

    # ------------------------------------------------------------------ #
    # Lifecycle
    # ------------------------------------------------------------------ #

    def _load_analyzer(self) -> Any:
        if self._analyzer is not None:
            return self._analyzer
        if self._tried_load:
            return None
        self._tried_load = True

        try:
            if self._analyzer_loader is not None:
                self._analyzer = self._analyzer_loader()
            else:
                from deepface import DeepFace  # local import — heavy side-effects

                logger.info("Loading default DeepFace emotion analyser...")
                self._analyzer = DeepFace
                logger.info("DeepFace analyser ready")
            return self._analyzer
        except ImportError as exc:
            self._load_error = f"deepface missing: {exc}"
            logger.warning(self._load_error + " — using brightness fallback")
            return None
        except Exception as exc:  # pragma: no cover - env-dependent
            self._load_error = f"DeepFace failed to load: {exc}"
            logger.warning(self._load_error + " — using brightness fallback")
            return None

    def is_analyzer_available(self) -> bool:
        return self._load_analyzer() is not None

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #

    def analyze_video_emotions(
        self,
        video_path: str | Path,
        sample_rate: int = 5,
        max_frames: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Run DeepFace (or the brightness fallback) across a video.

        Returns::

            {
                "timeline": [
                    {frame, timestamp, dominant_emotion, emotions: {...}, method},
                    ...
                ],
                "summary":             {...},   # see `emotion_summary`
                "total_analyzed_frames": int,
                "source":              "deepface" | "fallback:brightness" |
                                       "fallback:unavailable" | "error",
                "error":               "...",   # only when source is error / unavailable
            }
        """
        try:
            path = validate_video_path(video_path)
        except (FileNotFoundError, ValueError) as exc:
            return self._video_error(str(exc))

        analyzer = self._load_analyzer()
        using_fallback = analyzer is None
        source = "fallback:brightness" if using_fallback else "deepface"

        timeline: List[Dict[str, Any]] = []
        try:
            for frame_index, timestamp, frame in iter_frames(
                path, sample_rate=sample_rate, max_frames=max_frames
            ):
                if using_fallback:
                    timeline.append(
                        self._fallback_frame(frame, frame_index, timestamp)
                    )
                    continue

                frame_data = self._analyze_frame(analyzer, frame, frame_index, timestamp)
                if frame_data is not None:
                    timeline.append(frame_data)
        except Exception as exc:
            logger.error("Emotion analysis failed: %s", exc)
            return self._video_error(f"analysis failed: {exc}")

        if using_fallback and self._load_error:
            logger.info("Emotion timeline built via brightness fallback (%d frames)", len(timeline))

        summary = self.emotion_summary(timeline)

        result: Dict[str, Any] = {
            "timeline": timeline,
            "summary": summary,
            "total_analyzed_frames": len(timeline),
            "source": source,
        }
        if using_fallback and self._load_error:
            result["error"] = self._load_error
        return result

    def emotion_summary(self, timeline: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Reduce a timeline to ``{dominant_emotion, distribution, emotion_stability}``.

        ``VideoPipeline`` reads ``emotion_stability`` directly to populate
        the ``video_metrics`` dict for ``ScoringEngine``.
        """
        if not timeline:
            return {
                "dominant_emotion": "unknown",
                "distribution": {e: 0.0 for e in CANONICAL_EMOTIONS},
                "emotion_stability": 0.0,
                "total_frames": 0,
            }

        labels = [str(entry.get("dominant_emotion") or "unknown") for entry in timeline]

        counts: Dict[str, int] = {}
        for label in labels:
            counts[label] = counts.get(label, 0) + 1

        total = len(labels)
        dominant = max(counts, key=counts.get)

        distribution: Dict[str, float] = {e: 0.0 for e in CANONICAL_EMOTIONS}
        for label, count in counts.items():
            distribution[label] = float(count) / float(total)

        stability = emotion_stability(labels)

        return {
            "dominant_emotion": dominant,
            "distribution": distribution,
            "emotion_stability": float(stability),
            "total_frames": total,
        }

    # ------------------------------------------------------------------ #
    # Per-frame analysers
    # ------------------------------------------------------------------ #

    def _analyze_frame(
        self,
        analyzer: Any,
        frame: np.ndarray,
        frame_index: int,
        timestamp: float,
    ) -> Optional[Dict[str, Any]]:
        """Run DeepFace on a single BGR frame. Returns ``None`` on failure."""
        try:
            raw = analyzer.analyze(
                frame,
                actions=["emotion"],
                enforce_detection=False,
            )
        except Exception as exc:
            logger.warning("DeepFace.analyze failed on frame %d: %s", frame_index, exc)
            return None

        first = _first_result(raw)
        if not first:
            return None

        emotions_raw = first.get("emotion") or {}
        normalised = _normalise_scores(emotions_raw)

        dominant_raw = first.get("dominant_emotion")
        dominant = (
            str(dominant_raw).lower()
            if dominant_raw
            else (max(normalised, key=normalised.get) if normalised else "unknown")
        )

        return {
            "frame": int(frame_index),
            "timestamp": float(timestamp),
            "dominant_emotion": dominant,
            "emotions": normalised,
            "method": "deepface",
        }

    @staticmethod
    def _fallback_frame(
        frame: np.ndarray,
        frame_index: int,
        timestamp: float,
    ) -> Dict[str, Any]:
        """Brightness + contrast heuristic (mirrors the guide's fallback)."""
        gray = bgr_to_gray(frame)
        if gray is None or gray.size == 0:
            emotion = "neutral"
            brightness = 0.0
            contrast = 0.0
        else:
            brightness = float(np.mean(gray))
            contrast = float(np.std(gray))

            if brightness > 150:
                emotion = "happy"
            elif brightness < 100:
                emotion = "sad"
            elif contrast > 50:
                emotion = "angry"
            else:
                emotion = "neutral"

        emotions = {e: (0.7 if e == emotion else 0.05) for e in CANONICAL_EMOTIONS}

        return {
            "frame": int(frame_index),
            "timestamp": float(timestamp),
            "dominant_emotion": emotion,
            "emotions": emotions,
            "method": "fallback:brightness",
        }

    # ------------------------------------------------------------------ #
    # Error helpers
    # ------------------------------------------------------------------ #

    @staticmethod
    def _video_error(message: str) -> Dict[str, Any]:
        return {
            "timeline": [],
            "summary": {
                "dominant_emotion": "unknown",
                "distribution": {e: 0.0 for e in CANONICAL_EMOTIONS},
                "emotion_stability": 0.0,
                "total_frames": 0,
            },
            "total_analyzed_frames": 0,
            "source": "error",
            "error": message,
        }


# --------------------------------------------------------------------------- #
# DeepFace output helpers
# --------------------------------------------------------------------------- #


def _first_result(raw: Any) -> Optional[Dict[str, Any]]:
    """DeepFace.analyze returns a list of dicts (one per detected face).

    Older versions returned a single dict. This helper accepts both.
    """
    if isinstance(raw, list):
        if not raw:
            return None
        candidate = raw[0]
        return candidate if isinstance(candidate, dict) else None
    if isinstance(raw, dict):
        return raw
    return None


def _normalise_scores(scores: Dict[str, Any]) -> Dict[str, float]:
    """Lowercase keys, coerce to float, and renormalise to [0, 1].

    DeepFace returns percentages (0-100). We keep everything on the 0-1
    scale so the downstream UI can format consistently and the sums are
    comparable across frames.
    """
    out: Dict[str, float] = {}
    for key, value in (scores or {}).items():
        try:
            out[str(key).lower()] = float(value)
        except (TypeError, ValueError):
            continue

    if not out:
        return {e: 0.0 for e in CANONICAL_EMOTIONS}

    total = sum(out.values())
    if total > 0:
        out = {k: v / total for k, v in out.items()}

    for e in CANONICAL_EMOTIONS:
        out.setdefault(e, 0.0)

    return out
