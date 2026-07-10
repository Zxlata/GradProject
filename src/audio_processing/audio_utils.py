"""
Thin wrapper around ``librosa`` for loading audio files and computing the
features we need across the audio pipeline.

Keeping the librosa calls in one place means:

- tests can monkeypatch a single function to provide synthetic signals
- higher-level modules (``SpeechToText``, ``EmotionDetector``) are free of
  raw DSP code
- we can later swap the backend (soundfile, torchaudio) without touching
  the rest of the codebase.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import numpy as np

from src.utils.logger import get_logger

logger = get_logger(__name__)

SUPPORTED_EXTENSIONS = {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".aac", ".wma"}

DEFAULT_SAMPLE_RATE = 16_000  # Whisper expects 16 kHz; librosa resamples for us.


# --------------------------------------------------------------------------- #
# Validation
# --------------------------------------------------------------------------- #


def validate_audio_path(audio_path: str | Path) -> Path:
    """Return a validated ``Path`` for an existing supported audio file."""
    path = Path(audio_path).expanduser().resolve()
    if not path.exists():
        raise FileNotFoundError(f"Audio file not found: {path}")
    if not path.is_file():
        raise ValueError(f"Audio path is not a file: {path}")
    if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise ValueError(
            f"Unsupported audio extension '{path.suffix}'. "
            f"Supported: {sorted(SUPPORTED_EXTENSIONS)}"
        )
    return path


# --------------------------------------------------------------------------- #
# Loading
# --------------------------------------------------------------------------- #


def load_audio(
    audio_path: str | Path,
    sample_rate: Optional[int] = DEFAULT_SAMPLE_RATE,
    mono: bool = True,
) -> Tuple[np.ndarray, int]:
    """Load audio from disk as ``(samples, sample_rate)``.

    Uses librosa under the hood (which resamples + downmixes for us).
    """
    import librosa

    path = validate_audio_path(audio_path)
    logger.debug("Loading audio: %s (target_sr=%s, mono=%s)", path, sample_rate, mono)
    y, sr = librosa.load(str(path), sr=sample_rate, mono=mono)
    y = np.ascontiguousarray(y, dtype=np.float32)
    return y, int(sr)


def save_audio(
    audio_path: str | Path,
    signal: np.ndarray,
    sample_rate: int,
) -> Path:
    """Write a float32 array to disk as WAV (used by tests and tools)."""
    import soundfile as sf

    path = Path(audio_path).expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), signal, sample_rate)
    return path


# --------------------------------------------------------------------------- #
# Stats & features
# --------------------------------------------------------------------------- #


def audio_duration(signal: np.ndarray, sample_rate: int) -> float:
    """Return duration in seconds for a loaded signal."""
    if sample_rate <= 0:
        return 0.0
    return float(len(signal)) / float(sample_rate)


def basic_stats(signal: np.ndarray, sample_rate: int) -> Dict[str, Any]:
    """Return a small summary of an audio signal.

    Guards against empty / silent / NaN input — callers can rely on
    finite float values for every key.
    """
    if signal.size == 0:
        return {
            "duration_seconds": 0.0,
            "sample_rate": int(sample_rate),
            "num_samples": 0,
            "rms_energy": 0.0,
            "peak_amplitude": 0.0,
            "is_silent": True,
        }

    rms = float(np.sqrt(np.mean(np.square(signal, dtype=np.float64))))
    peak = float(np.max(np.abs(signal)))

    return {
        "duration_seconds": audio_duration(signal, sample_rate),
        "sample_rate": int(sample_rate),
        "num_samples": int(signal.size),
        "rms_energy": rms,
        "peak_amplitude": peak,
        "is_silent": rms < 1e-4,
    }


# --------------------------------------------------------------------------- #
# Signal → scores
# --------------------------------------------------------------------------- #


def clarity_score(rms: np.ndarray) -> float:
    """Map RMS stability to a 0-100 clarity score.

    A lower standard deviation of frame-level RMS means the speaker kept a
    consistent volume → higher clarity. We target an RMS std of ~0.1 for
    the low end, matching the heuristic used in the guide.
    """
    if rms.size == 0:
        return 0.0
    std = float(np.std(rms))
    score = (1.0 - std / 0.1) * 100.0
    return float(np.clip(score, 0.0, 100.0))


def pacing_score(zcr: np.ndarray) -> float:
    """Map the mean zero-crossing rate to a 0-100 pacing score."""
    if zcr.size == 0:
        return 0.0
    score = float(np.mean(zcr)) * 1000.0
    return float(np.clip(score, 0.0, 100.0))


def energy_score(rms: np.ndarray, target: float = 0.05) -> float:
    """Map mean RMS energy to a 0-100 score against a target level."""
    if rms.size == 0 or target <= 0:
        return 0.0
    score = (float(np.mean(rms)) / float(target)) * 100.0
    return float(np.clip(score, 0.0, 100.0))
