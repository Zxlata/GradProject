"""
Emotion detection + speech-quality analysis.

Design:

- **Wav2Vec2 first, light fallback.** The primary emotion classifier is a
  HuggingFace ``wav2vec2`` model (see :mod:`src.audio_processing.audio_emotion_model`).
  If the model fails to load (no internet, missing ``transformers``, etc.)
  we degrade gracefully to a tiny librosa-based shape guess so the rest of
  the pipeline keeps producing a dict of the expected shape.
- ``analyze_speech_quality`` still returns clarity / pacing / energy scores
  in 0-100 ready for ``ScoringEngine.audio_metrics`` — these are pure
  signal-processing metrics and are intentionally kept (the heuristic
  *emotion* guess is what we replaced).
- ``audio_metrics_for_scoring`` wraps both and emits the exact keys
  ``ScoringEngine`` expects.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, Optional

import numpy as np

from src.audio_processing.audio_emotion_model import (
    CANONICAL_EMOTIONS,
    Wav2Vec2EmotionModel,
)
from src.audio_processing.audio_utils import (
    audio_duration,
    clarity_score,
    energy_score,
    load_audio,
    pacing_score,
    validate_audio_path,
)
from src.utils.logger import get_logger

logger = get_logger(__name__)

_EMOTIONS = CANONICAL_EMOTIONS


class EmotionDetector:
    """Detect emotion (wav2vec2) + analyze speech quality (librosa)."""

    def __init__(
        self,
        model_loader: Optional[Callable[[], Any]] = None,
    ) -> None:
        # ``model_loader`` builds the emotion model on first use. Injecting
        # a fake here is how tests avoid downloading 350 MB of weights.
        self._model_loader = model_loader
        self._model: Any = None
        self._load_error: Optional[str] = None
        self._tried_load = False

    # ------------------------------------------------------------------ #
    # Lifecycle
    # ------------------------------------------------------------------ #

    def _load_model(self) -> Any:
        if self._model is not None:
            return self._model
        if self._tried_load:
            return None
        self._tried_load = True

        try:
            if self._model_loader is not None:
                self._model = self._model_loader()
            else:
                # Local import so test files that monkeypatch config work.
                from config import (
                    EMOTION_MODEL_CACHE_DIR,
                    EMOTION_MODEL_DEVICE,
                    EMOTION_MODEL_NAME,
                )

                logger.info("Loading default wav2vec2 emotion model...")
                model = Wav2Vec2EmotionModel(
                    model_name=EMOTION_MODEL_NAME,
                    device=EMOTION_MODEL_DEVICE,
                    cache_dir=EMOTION_MODEL_CACHE_DIR,
                )
                model.load()
                self._model = model
                logger.info("wav2vec2 emotion model ready")
            return self._model
        except ImportError as exc:
            self._load_error = f"wav2vec2 dependencies missing: {exc}"
            logger.warning(self._load_error + " — using minimal fallback")
            return None
        except Exception as exc:  # pragma: no cover - env-dependent
            self._load_error = f"wav2vec2 model failed to load: {exc}"
            logger.warning(self._load_error + " — using minimal fallback")
            return None

    def is_model_available(self) -> bool:
        return self._load_model() is not None

    # Kept for backwards compat with older call sites (e.g. sidebar badges).
    is_speechbrain_available = is_model_available

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #

    def detect_emotion(self, audio_path: str) -> Dict[str, Any]:
        """Return ``{emotion, confidence, all_scores, source}`` for a file."""
        try:
            path = validate_audio_path(audio_path)
        except (FileNotFoundError, ValueError) as exc:
            return self._emotion_error(str(exc))

        model = self._load_model()
        if model is not None:
            try:
                out = model.predict(str(path))
                return {
                    "emotion": out.get("label", "unknown"),
                    "confidence": float(out.get("confidence", 0.0)),
                    "all_scores": self._normalise_scores(out.get("all_scores", {})),
                    "source": "wav2vec2",
                }
            except Exception as exc:
                logger.error("wav2vec2 predict failed: %s — falling back", exc)

        return self._detect_emotion_fallback(path)

    def analyze_speech_quality(self, audio_path: str) -> Dict[str, Any]:
        """Return clarity / pacing / energy / confidence scores (0-100)."""
        import librosa

        try:
            signal, sr = load_audio(audio_path)
        except (FileNotFoundError, ValueError) as exc:
            return {"error": str(exc)}

        if signal.size == 0:
            return {
                "duration_seconds": 0.0,
                "clarity_score": 0.0,
                "pacing_score": 0.0,
                "energy_score": 0.0,
                "confidence_score": 0.0,
                "overall_quality": "empty",
            }

        rms = librosa.feature.rms(y=signal)[0]
        zcr = librosa.feature.zero_crossing_rate(signal)[0]

        clarity = clarity_score(rms)
        pacing = pacing_score(zcr)
        energy = energy_score(rms)

        # Confidence = steady volume + enough energy
        confidence = self._confidence_from_signal(signal, rms)

        duration = audio_duration(signal, sr)
        overall = self._overall_quality_label(duration, clarity, energy)

        return {
            "duration_seconds": duration,
            "clarity_score": float(clarity),
            "pacing_score": float(pacing),
            "energy_score": float(energy),
            "confidence_score": float(confidence),
            "overall_quality": overall,
        }

    def audio_metrics_for_scoring(self, audio_path: str) -> Optional[Dict[str, float]]:
        """Shape ``analyze_speech_quality`` output for ``ScoringEngine``."""
        q = self.analyze_speech_quality(audio_path)
        if "error" in q:
            return None
        return {
            "confidence_score": q["confidence_score"],
            "clarity_score": q["clarity_score"],
            "pacing_score": q["pacing_score"],
            "energy_score": q["energy_score"],
        }

    # ------------------------------------------------------------------ #
    # Fallbacks
    # ------------------------------------------------------------------ #

    def _detect_emotion_fallback(self, audio_path) -> Dict[str, Any]:
        """Minimal shape-preserving fallback when wav2vec2 is unavailable.

        This intentionally does *not* try to mimic the old rule-based
        classifier. It just picks a safe label based on loudness so the
        downstream dict always has the expected keys and types.
        """
        import librosa

        try:
            signal, sr = load_audio(audio_path)
        except Exception as exc:
            return self._emotion_error(str(exc))

        if signal.size == 0:
            return {
                "emotion": "unknown",
                "confidence": 0.0,
                "all_scores": {e: 0.0 for e in _EMOTIONS},
                "source": "fallback:empty",
            }

        rms_energy = float(np.mean(librosa.feature.rms(y=signal)[0]))

        if rms_energy < 0.02:
            emotion, confidence = "sad", 0.5
        elif rms_energy > 0.1:
            emotion, confidence = "happy", 0.5
        else:
            emotion, confidence = "neutral", 0.5

        scores = {e: 0.0 for e in _EMOTIONS}
        scores[emotion] = confidence

        return {
            "emotion": emotion,
            "confidence": confidence,
            "all_scores": scores,
            "source": "fallback:model_unavailable",
        }

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #

    @staticmethod
    def _confidence_from_signal(signal: np.ndarray, rms: np.ndarray) -> float:
        """Combine volume stability and average loudness into a 0-100 score."""
        if rms.size == 0 or signal.size == 0:
            return 0.0
        mean_rms = float(np.mean(rms))
        std_rms = float(np.std(rms))
        steadiness = max(0.0, 1.0 - (std_rms / 0.1))        # 0..1
        loudness = min(1.0, mean_rms / 0.05)                # 0..1
        return float(np.clip((0.6 * steadiness + 0.4 * loudness) * 100.0, 0.0, 100.0))

    @staticmethod
    def _overall_quality_label(duration: float, clarity: float, energy: float) -> str:
        if duration < 5:
            return "too_short"
        if clarity < 40 or energy < 20:
            return "poor"
        if clarity < 70:
            return "fair"
        return "good"

    @staticmethod
    def _normalise_scores(scores: Dict[str, Any]) -> Dict[str, float]:
        """Ensure every canonical emotion has a float entry in ``all_scores``."""
        out: Dict[str, float] = {e: 0.0 for e in _EMOTIONS}
        for key, value in (scores or {}).items():
            try:
                out[str(key)] = float(value)
            except (TypeError, ValueError):
                continue
        # Preserve non-canonical labels too so the UI can show them if it wants
        for key in scores or {}:
            if key not in out:
                try:
                    out[key] = float(scores[key])
                except (TypeError, ValueError):
                    pass
        return out

    @staticmethod
    def _emotion_error(message: str) -> Dict[str, Any]:
        return {
            "emotion": "unknown",
            "confidence": 0.0,
            "all_scores": {e: 0.0 for e in _EMOTIONS},
            "source": "error",
            "error": message,
        }
