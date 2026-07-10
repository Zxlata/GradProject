"""
POST /analyze-video — single-answer multimodal analysis from a video upload.

This is the API surface for ``AnswerPipeline.analyze``
(src/interview/answer_pipeline.py), which already orchestrates:

    - audio extraction via the bundled imageio-ffmpeg binary,
    - Whisper transcription,
    - librosa audio metrics,
    - wav2vec2 speech emotion,
    - MediaPipe face tracking,
    - DeepFace facial emotion,

and returns the unified envelope the frontend feedback page consumes. We
expose it as-is — no model logic is duplicated here.
"""

from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status

from api.schemas import ApiResponse
from api.schemas.video import AnalyzeVideoData
from api.services import get_answer_pipeline, save_upload
from config import RECORDINGS_DIR

router = APIRouter(tags=["video"])

_ALLOWED_VIDEO_EXTS = {".mp4", ".mov", ".webm", ".avi", ".mkv", ".m4v"}


@router.post("/analyze-video", response_model=ApiResponse[AnalyzeVideoData])
async def analyze_video(
    file: UploadFile = File(...),
    face_sample_rate: int = Form(default=5, ge=1, le=60),
    emotion_sample_rate: int = Form(default=15, ge=1, le=60),
    max_frames: int = Form(default=600, ge=1, le=10_000),
) -> ApiResponse[AnalyzeVideoData]:
    """Run the full video-first answer pipeline on a single uploaded video."""
    name = (file.filename or "").lower()
    if not any(name.endswith(ext) for ext in _ALLOWED_VIDEO_EXTS):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported video extension. Allowed: {sorted(_ALLOWED_VIDEO_EXTS)}",
        )

    saved_path = save_upload(
        file.file, file.filename or "video.mp4", RECORDINGS_DIR, fallback_extension=".mp4"
    )

    pipeline = get_answer_pipeline()
    analysis = pipeline.analyze(
        str(saved_path),
        face_sample_rate=face_sample_rate,
        emotion_sample_rate=emotion_sample_rate,
        max_frames=max_frames,
    )

    data = AnalyzeVideoData(**analysis)
    return ApiResponse.ok(data=data, message="Video analysed")
