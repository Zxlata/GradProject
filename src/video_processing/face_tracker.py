"""
Face tracking with MediaPipe.

Design mirrors :class:`src.audio_processing.emotion_detector.EmotionDetector`:

- **MediaPipe-first, lazy loaded.** The ``FaceDetection`` solution is only
  built on the first ``process_video`` call. If ``mediapipe`` is missing or
  blows up on import, we flip ``_load_error`` and return a safe empty
  result so the rest of the pipeline keeps working.
- **Injectable ``detector_loader``.** Tests pass a fake callable that returns
  a stub with a ``process(rgb_frame)`` method, so nothing has to touch real
  MediaPipe internals.
- **No scoring math lives here.** ``process_video`` returns raw per-frame
  face info (confidence, bbox, landmarks). ``calculate_engagement_metrics``
  reduces that to a small dict by delegating to the pure helpers in
  :mod:`src.video_processing.video_utils` (``face_presence_ratio``,
  ``eye_contact_score``, ``engagement_score``). The shape of that dict is
  what :class:`VideoPipeline` reads when emitting
  ``video_metrics`` for :class:`~src.evaluation.scoring.ScoringEngine`.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from src.utils.logger import get_logger
from src.video_processing.video_utils import (
    bgr_to_rgb,
    engagement_score,
    eye_contact_score,
    face_presence_ratio,
    iter_frames,
    validate_video_path,
)

logger = get_logger(__name__)


class FaceTracker:
    """Track faces in a video using MediaPipe Face Detection."""

    def __init__(
        self,
        detector_loader: Optional[Callable[[], Any]] = None,
        min_detection_confidence: float = 0.5,
    ) -> None:
        # ``detector_loader`` builds the MediaPipe detector on first use.
        # Injecting a fake here is how tests avoid pulling in the real
        # solution graph.
        self._detector_loader = detector_loader
        self._min_detection_confidence = float(min_detection_confidence)

        self._detector: Any = None
        self._load_error: Optional[str] = None
        self._tried_load = False

    # ------------------------------------------------------------------ #
    # Lifecycle
    # ------------------------------------------------------------------ #

    def _load_detector(self) -> Any:
        if self._detector is not None:
            return self._detector
        if self._tried_load:
            return None
        self._tried_load = True

        try:
            if self._detector_loader is not None:
                self._detector = self._detector_loader()
            else:
                import mediapipe as mp  # local import — cheap module, heavy side-effects

                logger.info("Loading default MediaPipe FaceDetection...")
                self._detector = mp.solutions.face_detection.FaceDetection(
                    min_detection_confidence=self._min_detection_confidence,
                )
                logger.info("MediaPipe FaceDetection ready")
            return self._detector
        except ImportError as exc:
            self._load_error = f"mediapipe missing: {exc}"
            logger.warning(self._load_error + " — face tracking disabled")
            return None
        except Exception as exc:  # pragma: no cover - env-dependent
            self._load_error = f"MediaPipe failed to load: {exc}"
            logger.warning(self._load_error + " — face tracking disabled")
            return None

    def is_detector_available(self) -> bool:
        return self._load_detector() is not None

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #

    def process_video(
        self,
        video_path: str | Path,
        sample_rate: int = 1,
        max_frames: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Run MediaPipe face detection over a video file.

        Returns a dict of::

            {
                "frames":       [ {frame_number, timestamp, faces: [...]}, ... ],
                "total_frames": int,   # frames actually processed (after sampling)
                "source":       "mediapipe" | "error" | "fallback:unavailable",
                "error":        str,   # only present if source != "mediapipe"
            }

        Each ``faces`` entry has ``confidence``, ``location`` (normalised +
        pixel bbox), and ``landmarks`` (normalised keypoints).
        """
        try:
            path = validate_video_path(video_path)
        except (FileNotFoundError, ValueError) as exc:
            return self._video_error(str(exc))

        detector = self._load_detector()
        if detector is None:
            return {
                "frames": [],
                "total_frames": 0,
                "source": "fallback:unavailable",
                "error": self._load_error or "MediaPipe detector unavailable",
            }

        frames: List[Dict[str, Any]] = []
        try:
            for frame_index, timestamp, frame in iter_frames(
                path, sample_rate=sample_rate, max_frames=max_frames
            ):
                rgb = bgr_to_rgb(frame)
                detection_result = detector.process(rgb)

                frame_data: Dict[str, Any] = {
                    "frame_number": frame_index,
                    "timestamp": timestamp,
                    "faces": [],
                }

                detections = getattr(detection_result, "detections", None) or []
                frame_shape: Tuple[int, int] = (
                    int(frame.shape[0]),
                    int(frame.shape[1]),
                )
                for detection in detections:
                    frame_data["faces"].append(
                        {
                            "confidence": _first_score(detection),
                            "location": _extract_location(detection, frame_shape),
                            "landmarks": _extract_landmarks(detection),
                        }
                    )

                frames.append(frame_data)
        except Exception as exc:
            logger.error("MediaPipe processing failed: %s", exc)
            return self._video_error(f"processing failed: {exc}")

        logger.info(
            "FaceTracker processed %d frames (sample_rate=%d)",
            len(frames),
            sample_rate,
        )

        return {
            "frames": frames,
            "total_frames": len(frames),
            "source": "mediapipe",
        }

    def calculate_engagement_metrics(
        self, process_result: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Reduce raw ``process_video`` output to an engagement summary.

        Output::

            {
                "face_presence_ratio":     0.0-1.0,
                "eye_contact_score":       0.0-1.0,      # 0-1 scale
                "engagement_score":        0.0-100.0,
                "average_face_confidence": 0.0-1.0,
                "frames_with_face":        int,
                "total_frames":            int,
                "source":                  "mediapipe" | "fallback:unavailable" | "error",
            }

        ``VideoPipeline`` uses the first three keys directly when building
        the ``video_metrics`` dict for ``ScoringEngine``. The extras are
        there for the UI / debugging.
        """
        if not process_result or "error" in process_result:
            return self._engagement_error(
                process_result.get("error", "no face data available")
                if process_result
                else "no face data available",
                source=(process_result or {}).get("source", "error"),
            )

        frames: List[Dict[str, Any]] = process_result.get("frames") or []
        total_frames = int(process_result.get("total_frames", len(frames)))

        if total_frames == 0:
            return self._engagement_error(
                "no frames processed",
                source=process_result.get("source", "error"),
            )

        frames_with_face = sum(1 for f in frames if f.get("faces"))
        presence = face_presence_ratio(frames_with_face, total_frames)

        centers_x: List[float] = []
        confidences: List[float] = []
        for frame_data in frames:
            for face in frame_data.get("faces") or []:
                loc = face.get("location") or {}
                x = loc.get("x")
                w = loc.get("width")
                if isinstance(x, (int, float)) and isinstance(w, (int, float)):
                    centers_x.append(float(x) + float(w) / 2.0)
                confidence = face.get("confidence")
                if isinstance(confidence, (int, float)):
                    confidences.append(float(confidence))

        eye_contact = eye_contact_score(centers_x)
        engagement = engagement_score(presence, eye_contact)
        avg_confidence = (
            float(sum(confidences) / len(confidences)) if confidences else 0.0
        )

        return {
            "face_presence_ratio": presence,
            "eye_contact_score": eye_contact,
            "engagement_score": engagement,
            "average_face_confidence": avg_confidence,
            "frames_with_face": frames_with_face,
            "total_frames": total_frames,
            "source": process_result.get("source", "mediapipe"),
        }

    # ------------------------------------------------------------------ #
    # Error helpers
    # ------------------------------------------------------------------ #

    @staticmethod
    def _video_error(message: str) -> Dict[str, Any]:
        return {
            "frames": [],
            "total_frames": 0,
            "source": "error",
            "error": message,
        }

    @staticmethod
    def _engagement_error(message: str, source: str = "error") -> Dict[str, Any]:
        return {
            "face_presence_ratio": 0.0,
            "eye_contact_score": 0.0,
            "engagement_score": 0.0,
            "average_face_confidence": 0.0,
            "frames_with_face": 0,
            "total_frames": 0,
            "source": source,
            "error": message,
        }


# --------------------------------------------------------------------------- #
# Detection-object helpers (MediaPipe output normalisation)
# --------------------------------------------------------------------------- #


def _first_score(detection: Any) -> float:
    scores = getattr(detection, "score", None)
    if scores is None:
        return 0.0
    try:
        return float(scores[0])
    except (IndexError, TypeError, ValueError):
        return 0.0


def _extract_location(detection: Any, frame_shape: Tuple[int, int]) -> Dict[str, float]:
    """Return a normalised + pixel bounding box from a MediaPipe detection."""
    location_data = getattr(detection, "location_data", None)
    bbox = getattr(location_data, "relative_bounding_box", None) if location_data else None
    if bbox is None:
        return {
            "x": 0.0,
            "y": 0.0,
            "width": 0.0,
            "height": 0.0,
            "x_pixel": 0,
            "y_pixel": 0,
            "width_pixel": 0,
            "height_pixel": 0,
        }

    h, w = int(frame_shape[0]), int(frame_shape[1])
    x = float(getattr(bbox, "xmin", 0.0) or 0.0)
    y = float(getattr(bbox, "ymin", 0.0) or 0.0)
    bw = float(getattr(bbox, "width", 0.0) or 0.0)
    bh = float(getattr(bbox, "height", 0.0) or 0.0)

    return {
        "x": x,
        "y": y,
        "width": bw,
        "height": bh,
        "x_pixel": int(x * w),
        "y_pixel": int(y * h),
        "width_pixel": int(bw * w),
        "height_pixel": int(bh * h),
    }


def _extract_landmarks(detection: Any) -> List[Dict[str, float]]:
    """Return a list of ``{x, y}`` landmarks in [0, 1] (empty if unavailable)."""
    location_data = getattr(detection, "location_data", None)
    if location_data is None:
        return []

    keypoints = getattr(location_data, "relative_keypoints", None)
    if not keypoints:
        return []

    out: List[Dict[str, float]] = []
    for kp in keypoints:
        out.append(
            {
                "x": float(getattr(kp, "x", 0.0) or 0.0),
                "y": float(getattr(kp, "y", 0.0) or 0.0),
            }
        )
    return out
