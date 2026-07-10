"""
Composition layer that ties video analysis to :class:`ScoringEngine`.

Parallels :meth:`src.audio_processing.emotion_detector.EmotionDetector.audio_metrics_for_scoring`:
a single place that runs the per-modality analysers and emits the exact dict
shape downstream scoring expects. The audio pipeline does this inline on
``EmotionDetector`` because there is only one analyser; video has two
(``FaceTracker`` + ``EmotionAnalyzer``) so they get their own composition
class.

Contract with :class:`src.evaluation.scoring.ScoringEngine`::

    video_metrics = {
        "eye_contact_score": 0-1 (auto-promoted to 0-100 by the engine),
        "engagement_score":  0-100,
        "emotion_stability": 0-100,
    }

Any subset is accepted — ``_weighted_subscore`` in the scoring engine
renormalises around whichever keys are present. We only emit a key when
the underlying analyser actually produced a real signal for it, so a
failed face track doesn't silently contribute zeros to the final score.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional

from config import VIDEO_FRAME_SAMPLE_RATE
from src.utils.logger import get_logger
from src.video_processing.emotion_analyzer import EmotionAnalyzer
from src.video_processing.face_tracker import FaceTracker
from src.video_processing.video_utils import validate_video_path, video_info

logger = get_logger(__name__)

# Which ``source`` tags indicate a real, usable signal (vs. a stub / error).
_FACE_OK_SOURCES = {"mediapipe"}
_EMOTION_OK_SOURCES = {"deepface", "fallback:brightness"}


class VideoPipeline:
    """Run face tracking + facial-emotion analysis and emit scoring-ready metrics."""

    def __init__(
        self,
        face_tracker: Optional[FaceTracker] = None,
        emotion_analyzer: Optional[EmotionAnalyzer] = None,
    ) -> None:
        # Inject pre-built components in tests; default to real ones in prod.
        self.face_tracker = face_tracker or FaceTracker()
        self.emotion_analyzer = emotion_analyzer or EmotionAnalyzer()

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #

    def analyze(
        self,
        video_path: str | Path,
        face_sample_rate: int = 1,
        emotion_sample_rate: Optional[int] = None,
        max_frames: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Run both analysers and return a combined report.

        Parameters
        ----------
        face_sample_rate:
            Analyse every Nth frame for face detection. Defaults to every
            frame because MediaPipe is cheap and we want tight engagement
            estimates.
        emotion_sample_rate:
            Analyse every Nth frame for DeepFace emotion. Defaults to
            ``config.VIDEO_FRAME_SAMPLE_RATE`` because DeepFace is ~100×
            slower per frame than MediaPipe.
        max_frames:
            Optional cap passed through to both analysers (useful for tests
            and long recordings).

        Returns::

            {
                "info":          {...},                # from ``video_info``
                "face": {
                    "process":   FaceTracker.process_video(...) result,
                    "metrics":   FaceTracker.calculate_engagement_metrics(...) result,
                },
                "emotion":       EmotionAnalyzer.analyze_video_emotions(...) result,
                "video_metrics": {...} | None,         # ScoringEngine-ready
                "sources":       {"face": str, "emotion": str},
                "error":         "..."  # only set when validation fails up-front
            }
        """
        if emotion_sample_rate is None:
            emotion_sample_rate = VIDEO_FRAME_SAMPLE_RATE

        try:
            path = validate_video_path(video_path)
        except (FileNotFoundError, ValueError) as exc:
            return self._invalid(str(exc))

        info = self._safe_info(path)

        face_process = self.face_tracker.process_video(
            path, sample_rate=face_sample_rate, max_frames=max_frames
        )
        face_metrics = self.face_tracker.calculate_engagement_metrics(face_process)

        emotion_result = self.emotion_analyzer.analyze_video_emotions(
            path, sample_rate=emotion_sample_rate, max_frames=max_frames
        )

        video_metrics = self._build_video_metrics(face_metrics, emotion_result)

        sources = {
            "face": face_process.get("source", "error"),
            "emotion": emotion_result.get("source", "error"),
        }
        logger.info(
            "VideoPipeline done — face=%s, emotion=%s, metrics=%s",
            sources["face"],
            sources["emotion"],
            "present" if video_metrics else "none",
        )

        return {
            "info": info,
            "face": {"process": face_process, "metrics": face_metrics},
            "emotion": emotion_result,
            "video_metrics": video_metrics,
            "sources": sources,
        }

    def video_metrics_for_scoring(
        self,
        video_path: str | Path,
        **kwargs: Any,
    ) -> Optional[Dict[str, float]]:
        """Shortcut: run :meth:`analyze` and return only the scoring dict.

        Matches the signature style of
        ``EmotionDetector.audio_metrics_for_scoring`` so the Streamlit layer
        can treat both modalities uniformly (``None`` on failure, dict on
        success).
        """
        result = self.analyze(video_path, **kwargs)
        return result.get("video_metrics")

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #

    @staticmethod
    def _build_video_metrics(
        face_metrics: Dict[str, Any],
        emotion_result: Dict[str, Any],
    ) -> Optional[Dict[str, float]]:
        """Filter per-analyser output down to the keys ``ScoringEngine`` reads.

        Only emit a key when the underlying analyser actually produced a
        usable signal. Returning ``None`` when nothing is usable lets the
        scoring engine redistribute the video weight onto text/audio
        cleanly (same contract as the audio helper).
        """
        metrics: Dict[str, float] = {}

        face_source = str(face_metrics.get("source", ""))
        if face_source in _FACE_OK_SOURCES:
            eye = face_metrics.get("eye_contact_score")
            engagement = face_metrics.get("engagement_score")
            if isinstance(eye, (int, float)):
                metrics["eye_contact_score"] = float(eye)
            if isinstance(engagement, (int, float)):
                metrics["engagement_score"] = float(engagement)

        emotion_source = str(emotion_result.get("source", ""))
        if emotion_source in _EMOTION_OK_SOURCES:
            summary = emotion_result.get("summary") or {}
            stability = summary.get("emotion_stability")
            if isinstance(stability, (int, float)):
                metrics["emotion_stability"] = float(stability)

        return metrics or None

    @staticmethod
    def _safe_info(path: Path) -> Dict[str, Any]:
        try:
            return video_info(path)
        except Exception as exc:
            logger.warning("video_info failed for %s: %s", path, exc)
            return {
                "path": str(path),
                "fps": 0.0,
                "frame_count": 0,
                "duration_seconds": 0.0,
                "width": 0,
                "height": 0,
            }

    @staticmethod
    def _invalid(message: str) -> Dict[str, Any]:
        return {
            "info": {},
            "face": {"process": None, "metrics": None},
            "emotion": None,
            "video_metrics": None,
            "sources": {"face": "error", "emotion": "error"},
            "error": message,
        }
