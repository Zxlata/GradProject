"""
Video-first answer pipeline.

One uploaded video per question. We extract the audio track once and fan
it out across every analyser the system already has:

- :class:`~src.audio_processing.speech_to_text.SpeechToText` → Whisper transcript
- :class:`~src.audio_processing.emotion_detector.EmotionDetector` → wav2vec2
  facial-emotion wrapper + librosa speech quality
- :class:`~src.video_processing.video_pipeline.VideoPipeline` → MediaPipe
  face tracking + DeepFace facial emotion

:meth:`AnswerPipeline.analyze` returns a single unified dict per answer
with everything the Streamlit UI + :class:`~src.evaluation.scoring.ScoringEngine`
need. Keys follow the shape the user asked for::

    {
      "text":           str,
      "audio_metrics":  {...} | None,
      "audio_emotion":  {...} | None,
      "video_metrics":  {...} | None,
      "video_emotion":  {...} | None,
      ...
    }

Audio extraction uses the bundled ``imageio-ffmpeg`` binary so the system
``ffmpeg`` is **not** required — mirrors how ``SpeechToText`` already
pre-decodes audio via librosa instead of calling the system binary.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from src.audio_processing.emotion_detector import EmotionDetector
from src.audio_processing.speech_to_text import SpeechToText
from src.utils.logger import get_logger
from src.video_processing.video_pipeline import VideoPipeline
from src.video_processing.video_utils import validate_video_path

logger = get_logger(__name__)

_DEFAULT_SAMPLE_RATE = 16_000


# --------------------------------------------------------------------------- #
# Audio extraction helper
# --------------------------------------------------------------------------- #


def _locate_ffmpeg() -> str:
    """Return a usable ``ffmpeg`` binary path.

    Prefers the bundled ``imageio-ffmpeg`` binary (always works, no system
    install needed). Falls back to a system ``ffmpeg`` on PATH for users
    who already have one. Raises :class:`RuntimeError` if neither is found.
    """
    try:
        import imageio_ffmpeg  # type: ignore

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:
        logger.debug("imageio-ffmpeg unavailable: %s", exc)

    system = shutil.which("ffmpeg")
    if system:
        return system

    raise RuntimeError(
        "Cannot locate an ffmpeg binary. Install imageio-ffmpeg "
        "(`pip install imageio-ffmpeg`) or put ffmpeg on PATH."
    )


def extract_audio_from_video(
    video_path: str | Path,
    output_path: Optional[str | Path] = None,
    sample_rate: int = _DEFAULT_SAMPLE_RATE,
    ffmpeg_locator: Callable[[], str] = _locate_ffmpeg,
) -> Path:
    """Extract a mono PCM WAV track from a video file.

    Parameters
    ----------
    video_path:
        Existing video file (MP4 / WEBM / MOV / ...). Format is checked by
        :func:`validate_video_path`.
    output_path:
        Optional explicit WAV destination. Defaults to
        ``<video stem>.extracted.wav`` next to the video.
    sample_rate:
        Target sample rate. Defaults to 16 kHz — the rate Whisper + wav2vec2
        both consume natively.
    ffmpeg_locator:
        Test seam — inject a function that returns an ffmpeg path. Defaults
        to :func:`_locate_ffmpeg`.

    Returns the path of the extracted WAV. Raises :class:`RuntimeError` on
    failure (bad codec, no audio stream, ffmpeg missing).
    """
    path = validate_video_path(video_path)
    if output_path is None:
        output_path = path.with_suffix(".extracted.wav")
    out = Path(output_path).expanduser().resolve()
    out.parent.mkdir(parents=True, exist_ok=True)

    ffmpeg_exe = ffmpeg_locator()

    cmd = [
        ffmpeg_exe,
        "-y",                       # overwrite
        "-i", str(path),
        "-vn",                      # no video
        "-ac", "1",                 # mono
        "-ar", str(int(sample_rate)),
        "-acodec", "pcm_s16le",     # WAV PCM
        str(out),
    ]

    logger.info("Extracting audio: %s -> %s", path.name, out.name)
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0 or not out.exists() or out.stat().st_size == 0:
        tail = (result.stderr or "").strip().splitlines()[-6:]
        raise RuntimeError(
            f"ffmpeg failed to extract audio from {path.name}: "
            + (" | ".join(tail) if tail else "unknown error")
        )

    return out


# --------------------------------------------------------------------------- #
# AnswerPipeline
# --------------------------------------------------------------------------- #


class AnswerPipeline:
    """End-to-end analyser for a single video answer.

    Composes :class:`VideoPipeline`, :class:`SpeechToText`, and
    :class:`EmotionDetector`. Any of them can be injected — the defaults
    use the same singletons the Streamlit layer caches.
    """

    def __init__(
        self,
        video_pipeline: Optional[VideoPipeline] = None,
        speech_to_text: Optional[SpeechToText] = None,
        emotion_detector: Optional[EmotionDetector] = None,
        audio_extractor: Callable[..., Path] = extract_audio_from_video,
    ) -> None:
        self.video_pipeline = video_pipeline or VideoPipeline()
        self.speech_to_text = speech_to_text or SpeechToText()
        self.emotion_detector = emotion_detector or EmotionDetector()
        self._audio_extractor = audio_extractor

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #

    def analyze(
        self,
        video_path: str | Path,
        *,
        face_sample_rate: int = 5,
        emotion_sample_rate: int = 15,
        max_frames: Optional[int] = 600,
        audio_output_path: Optional[str | Path] = None,
    ) -> Dict[str, Any]:
        """Run the full video-first pipeline on a single answer.

        Returns a unified envelope::

            {
              "video_path":    str,
              "audio_path":    str | None,
              "text":          str,                    # Whisper transcript (may be empty)
              "audio_metrics": {...} | None,           # ScoringEngine.audio_metrics shape
              "audio_emotion": {emotion, confidence, all_scores, source} | None,
              "video_metrics": {...} | None,           # ScoringEngine.video_metrics shape
              "video_emotion": {dominant_emotion, distribution, emotion_stability, ...} | None,
              "face_metrics":  {...} | None,           # full FaceTracker summary
              "transcription": {...} | None,           # full SpeechToText envelope
              "sources": {audio_stt, audio_emotion, face, video_emotion},
              "errors":  [str],                        # any non-fatal extraction errors
            }

        The dict is safe even when extraction/transcription/analysis fail —
        unavailable pieces come back as ``None`` or empty strings so the UI
        and :class:`ScoringEngine` can consume a consistent shape.
        """
        try:
            video_path = validate_video_path(video_path)
        except (FileNotFoundError, ValueError) as exc:
            return self._invalid(str(exc), video_path)

        errors: list[str] = []

        audio_path = self._try_extract_audio(video_path, audio_output_path, errors)

        transcription = None
        text = ""
        audio_metrics: Optional[Dict[str, float]] = None
        audio_emotion: Optional[Dict[str, Any]] = None
        stt_source = "unavailable"
        audio_emotion_source = "unavailable"

        if audio_path is not None:
            transcription = self.speech_to_text.transcribe(str(audio_path))
            stt_source = transcription.get("source", "unavailable")
            if transcription.get("status") == "success":
                text = (transcription.get("text") or "").strip()

            audio_metrics = self.emotion_detector.audio_metrics_for_scoring(str(audio_path))
            audio_emotion = self.emotion_detector.detect_emotion(str(audio_path))
            audio_emotion_source = (audio_emotion or {}).get("source", "unavailable")
            if audio_emotion and audio_emotion.get("source") == "error":
                errors.append("audio_emotion: " + str(audio_emotion.get("error", "unknown")))
                audio_emotion = None

        video_result = self.video_pipeline.analyze(
            str(video_path),
            face_sample_rate=face_sample_rate,
            emotion_sample_rate=emotion_sample_rate,
            max_frames=max_frames,
        )
        video_metrics = video_result.get("video_metrics")
        face_metrics = (video_result.get("face") or {}).get("metrics")
        emotion_block = video_result.get("emotion") or {}
        video_emotion = emotion_block.get("summary")
        if video_emotion is None and emotion_block:
            video_emotion = {}
        video_sources = video_result.get("sources") or {}

        logger.info(
            "AnswerPipeline done — video=%s, stt=%s, audio_emotion=%s, "
            "face=%s, video_emotion=%s",
            video_path.name,
            stt_source,
            audio_emotion_source,
            video_sources.get("face", "?"),
            video_sources.get("emotion", "?"),
        )

        return {
            "video_path": str(video_path),
            "audio_path": str(audio_path) if audio_path else None,
            "text": text,
            "audio_metrics": audio_metrics,
            "audio_emotion": audio_emotion,
            "video_metrics": video_metrics,
            "video_emotion": video_emotion,
            "face_metrics": face_metrics,
            "transcription": transcription,
            "video_info": video_result.get("info", {}),
            "sources": {
                "audio_stt": stt_source,
                "audio_emotion": audio_emotion_source,
                "face": video_sources.get("face", "error"),
                "video_emotion": video_sources.get("emotion", "error"),
            },
            "errors": errors,
        }

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #

    def _try_extract_audio(
        self,
        video_path: Path,
        audio_output_path: Optional[str | Path],
        errors: list[str],
    ) -> Optional[Path]:
        try:
            return self._audio_extractor(
                video_path,
                output_path=audio_output_path,
            )
        except Exception as exc:
            logger.warning("Audio extraction failed for %s: %s", video_path.name, exc)
            errors.append(f"audio_extraction: {exc}")
            return None

    @staticmethod
    def _invalid(message: str, video_path: Any) -> Dict[str, Any]:
        return {
            "video_path": str(video_path) if video_path else None,
            "audio_path": None,
            "text": "",
            "audio_metrics": None,
            "audio_emotion": None,
            "video_metrics": None,
            "video_emotion": None,
            "face_metrics": None,
            "transcription": None,
            "video_info": {},
            "sources": {
                "audio_stt": "error",
                "audio_emotion": "error",
                "face": "error",
                "video_emotion": "error",
            },
            "errors": [message],
        }
