"""Schemas for /analyze-video (single-answer multimodal analysis)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class AnalyzeVideoData(BaseModel):
    """Mirrors the unified envelope returned by ``AnswerPipeline.analyze``."""

    video_path: Optional[str] = None
    audio_path: Optional[str] = None
    text: str = ""
    audio_metrics: Optional[Dict[str, float]] = None
    audio_emotion: Optional[Dict[str, Any]] = None
    video_metrics: Optional[Dict[str, float]] = None
    video_emotion: Optional[Dict[str, Any]] = None
    face_metrics: Optional[Dict[str, Any]] = None
    transcription: Optional[Dict[str, Any]] = None
    video_info: Dict[str, Any] = Field(default_factory=dict)
    sources: Dict[str, str] = Field(default_factory=dict)
    errors: List[str] = Field(default_factory=list)
