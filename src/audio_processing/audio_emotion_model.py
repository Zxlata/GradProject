"""
Wav2Vec2-based speech emotion classifier.

This module wraps a HuggingFace ``AutoModelForAudioClassification`` (by default
``superb/wav2vec2-base-superb-er``) so the rest of the pipeline can call a
single method and get an ``{label, confidence, all_scores}`` dict back.

Design notes:

- **Lazy loading.** The model (~350 MB) is only downloaded + loaded on the
  first ``predict()`` call, so importing this module is cheap and the
  Streamlit app starts fast.
- **CPU-first.** We assume CPU inference (no CUDA required). If the caller
  passes ``device="cuda"`` and torch reports CUDA available, we honour it.
- **No hard dependency at import time.** ``torch`` and ``transformers`` are
  imported inside ``load()`` so unit tests can inject a fake model via
  ``model_loader`` without needing the real stack.
- **Label normalisation.** The SUPERB checkpoint predicts the IEMOCAP-4
  classes (``neu / hap / ang / sad``). We map those to full English words
  so downstream consumers (UI, scoring) see human-readable labels.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Dict, Optional

import numpy as np

from src.audio_processing.audio_utils import load_audio, validate_audio_path
from src.utils.logger import get_logger

logger = get_logger(__name__)

# Canonical label set used across the rest of the audio pipeline.
CANONICAL_EMOTIONS = ("angry", "happy", "sad", "neutral", "fearful")

# Maps raw model labels to canonical English words.
_LABEL_MAP = {
    "neu": "neutral",
    "hap": "happy",
    "ang": "angry",
    "sad": "sad",
    "fea": "fearful",
    "fear": "fearful",
    "neutral": "neutral",
    "happy": "happy",
    "angry": "angry",
    "fearful": "fearful",
    "surprised": "neutral",  # fold unsupported classes into neutral
    "disgusted": "angry",
    "calm": "neutral",
}

DEFAULT_MODEL_NAME = "superb/wav2vec2-base-superb-er"
DEFAULT_SAMPLE_RATE = 16_000


class Wav2Vec2EmotionModel:
    """Thin wrapper around a HuggingFace wav2vec2 emotion classifier."""

    def __init__(
        self,
        model_name: str = DEFAULT_MODEL_NAME,
        device: Optional[str] = None,
        cache_dir: Optional[str | Path] = None,
    ) -> None:
        self.model_name = model_name
        self._requested_device = device
        self.cache_dir = str(cache_dir) if cache_dir else None

        self._model: Any = None
        self._feature_extractor: Any = None
        self._id2label: Dict[int, str] = {}
        self._device: str = "cpu"
        self._loaded = False

    # ------------------------------------------------------------------ #
    # Lifecycle
    # ------------------------------------------------------------------ #

    def load(self) -> None:
        """Download + load the model lazily. Safe to call repeatedly."""
        if self._loaded:
            return

        import torch  # local import keeps module import cheap
        from transformers import AutoFeatureExtractor, AutoModelForAudioClassification

        if self._requested_device == "cuda" and torch.cuda.is_available():
            self._device = "cuda"
        else:
            self._device = "cpu"

        logger.info(
            "Loading wav2vec2 emotion model '%s' on %s", self.model_name, self._device
        )

        kwargs: Dict[str, Any] = {}
        if self.cache_dir:
            kwargs["cache_dir"] = self.cache_dir

        self._feature_extractor = AutoFeatureExtractor.from_pretrained(
            self.model_name, **kwargs
        )
        model = AutoModelForAudioClassification.from_pretrained(
            self.model_name, **kwargs
        )
        self._model = model.to(self._device).eval()
        self._id2label = {int(k): str(v) for k, v in model.config.id2label.items()}
        self._loaded = True

        logger.info(
            "wav2vec2 emotion model ready — labels: %s",
            list(self._id2label.values()),
        )

    def is_loaded(self) -> bool:
        return self._loaded

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #

    def predict(self, audio_path: str | Path) -> Dict[str, Any]:
        """Classify a WAV/MP3/... file into an emotion.

        Returns::

            {
                "label": "happy" | "sad" | "angry" | "neutral" | ...,
                "confidence": 0.0 - 1.0,
                "all_scores": {"happy": 0.7, "sad": 0.1, ...},
            }
        """
        path = validate_audio_path(audio_path)
        signal, sr = load_audio(path, sample_rate=DEFAULT_SAMPLE_RATE, mono=True)

        if signal.size == 0:
            return {
                "label": "unknown",
                "confidence": 0.0,
                "all_scores": {e: 0.0 for e in CANONICAL_EMOTIONS},
            }

        self.load()

        import torch

        inputs = self._feature_extractor(
            signal,
            sampling_rate=sr,
            return_tensors="pt",
            padding=True,
        )
        inputs = {k: v.to(self._device) for k, v in inputs.items()}

        with torch.no_grad():
            logits = self._model(**inputs).logits

        probs = torch.softmax(logits, dim=-1).squeeze(0).detach().cpu().numpy()

        all_scores: Dict[str, float] = {e: 0.0 for e in CANONICAL_EMOTIONS}
        for idx, raw_label in self._id2label.items():
            if idx >= probs.size:
                continue
            canonical = _canonical_label(raw_label)
            all_scores[canonical] = float(probs[idx]) + all_scores.get(canonical, 0.0)

        best_idx = int(np.argmax(probs))
        best_label = _canonical_label(self._id2label.get(best_idx, "neutral"))
        confidence = float(probs[best_idx])

        return {
            "label": best_label,
            "confidence": confidence,
            "all_scores": all_scores,
        }


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def _canonical_label(raw: str) -> str:
    key = str(raw).strip().lower()
    return _LABEL_MAP.get(key, key or "neutral")


def default_model_factory() -> Callable[[], Wav2Vec2EmotionModel]:
    """Return a zero-arg factory that builds the default model.

    ``EmotionDetector`` uses this so callers can override the whole model
    (e.g. in tests) via a single callable.
    """

    def _factory() -> Wav2Vec2EmotionModel:
        return Wav2Vec2EmotionModel()

    return _factory
