"""
Speech-to-Text with OpenAI Whisper.

Whisper is optional: the ``whisper`` package pulls torch and downloads a
sizeable model on first use. If the package is missing we return a
structured error instead of crashing, so callers (and unit tests) can run
the rest of the audio pipeline.

Usage::

    stt = SpeechToText(model_size="base")
    if not stt.is_available():
        ...   # show a "Whisper not installed" message
    else:
        result = stt.transcribe("answer.wav")
        print(result["text"])
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from config import WHISPER_MODEL_SIZE
from src.audio_processing.audio_utils import basic_stats, load_audio, validate_audio_path
from src.utils.logger import get_logger

logger = get_logger(__name__)

_ALLOWED_SIZES = {"tiny", "base", "small", "medium", "large"}


class SpeechToText:
    """Thin wrapper around Whisper with lazy model loading."""

    def __init__(
        self,
        model_size: str = WHISPER_MODEL_SIZE,
        model_loader: Optional[Any] = None,
    ) -> None:
        if model_size not in _ALLOWED_SIZES:
            raise ValueError(
                f"Unknown Whisper model_size={model_size!r}. "
                f"Expected one of {sorted(_ALLOWED_SIZES)}"
            )
        self.model_size = model_size
        self._model_loader = model_loader  # injectable for tests
        self._model: Any = None
        self._load_error: Optional[str] = None

    # ------------------------------------------------------------------ #
    # Lifecycle
    # ------------------------------------------------------------------ #

    def _load_model(self) -> Any:
        if self._model is not None:
            return self._model
        if self._load_error is not None:
            return None

        try:
            if self._model_loader is not None:
                self._model = self._model_loader(self.model_size)
            else:
                import whisper  # type: ignore

                logger.info("Loading Whisper model '%s' (first call may download)...", self.model_size)
                self._model = whisper.load_model(self.model_size)
            logger.info("Whisper model '%s' ready", self.model_size)
            return self._model
        except ImportError as exc:
            self._load_error = f"whisper package not installed: {exc}"
            logger.warning(self._load_error)
            return None
        except Exception as exc:  # pragma: no cover - depends on env
            self._load_error = f"whisper model failed to load: {exc}"
            logger.error(self._load_error)
            return None

    def is_available(self) -> bool:
        """True if the Whisper model can be loaded on this machine."""
        return self._load_model() is not None

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #

    def transcribe(self, audio_path: str, language: Optional[str] = None) -> Dict[str, Any]:
        """Transcribe an audio file.

        Returns the same envelope on success and on failure — callers do
        not have to catch exceptions::

            {
                "status": "success" | "error",
                "text": str,
                "language": str | None,
                "duration": float | None,
                "segments": [...],
                "source": "whisper" | "unavailable" | "error",
                "error": str | None,
            }
        """
        try:
            path = validate_audio_path(audio_path)
        except (FileNotFoundError, ValueError) as exc:
            return self._error_envelope(str(exc), source="error")

        model = self._load_model()
        if model is None:
            return self._error_envelope(
                self._load_error or "Whisper is not available",
                source="unavailable",
            )

        # Pre-decode with librosa at 16 kHz mono so Whisper doesn't need ffmpeg.
        try:
            signal, _sr = load_audio(path, sample_rate=16_000, mono=True)
            duration = float(len(signal)) / 16_000.0
        except Exception as exc:
            logger.error("Audio pre-decode failed: %s", exc)
            return self._error_envelope(
                f"Could not decode audio: {exc}", source="error"
            )

        try:
            kwargs: Dict[str, Any] = {"fp16": False}
            if language:
                kwargs["language"] = language
            raw = model.transcribe(signal, **kwargs)
        except Exception as exc:
            logger.error("Whisper transcription failed: %s", exc)
            return self._error_envelope(str(exc), source="error")

        return {
            "status": "success",
            "text": (raw.get("text") or "").strip(),
            "language": raw.get("language"),
            "duration": raw.get("duration") or duration,
            "segments": raw.get("segments") or [],
            "source": "whisper",
            "error": None,
        }

    def transcribe_with_timestamps(self, audio_path: str) -> List[Dict[str, Any]]:
        """Return per-segment ``{start, end, text, confidence}`` rows."""
        result = self.transcribe(audio_path)
        segments: List[Dict[str, Any]] = []
        for seg in result.get("segments") or []:
            segments.append(
                {
                    "start": float(seg.get("start", 0.0)),
                    "end": float(seg.get("end", 0.0)),
                    "text": (seg.get("text") or "").strip(),
                    "confidence": float(seg.get("confidence", 0.0) or 0.0),
                }
            )
        return segments

    def get_audio_stats(self, audio_path: str) -> Dict[str, Any]:
        """Return duration / RMS / sample-rate stats without running Whisper."""
        try:
            signal, sr = load_audio(audio_path)
        except (FileNotFoundError, ValueError) as exc:
            return {"error": str(exc)}
        except Exception as exc:  # pragma: no cover
            logger.error("Failed to compute audio stats: %s", exc)
            return {"error": str(exc)}
        return basic_stats(signal, sr)

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #

    @staticmethod
    def _error_envelope(message: str, *, source: str) -> Dict[str, Any]:
        return {
            "status": "error",
            "text": "",
            "language": None,
            "duration": None,
            "segments": [],
            "source": source,
            "error": message,
        }
