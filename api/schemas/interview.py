"""Schemas for the /complete-interview endpoint."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class QAPair(BaseModel):
    """One question/answer for batch evaluation."""

    question: str = Field(..., min_length=1)
    answer: str = Field(default="")
    # Optional per-question multimodal metrics (e.g. when the website backend
    # already ran video analysis and just wants per-question final scores).
    audio_metrics: Optional[Dict[str, float]] = None
    video_metrics: Optional[Dict[str, float]] = None


class CompleteInterviewRequest(BaseModel):
    pairs: List[QAPair] = Field(..., min_length=1)
    role: str = Field(default="Software Engineer")
    # Aggregate metrics fed to the final-score calculation. If omitted, the
    # endpoint falls back to averaging whatever per-question metrics are
    # provided in `pairs`.
    avg_audio_metrics: Optional[Dict[str, float]] = None
    avg_video_metrics: Optional[Dict[str, float]] = None


class PerQuestionResult(BaseModel):
    question: str
    answer: str
    evaluation: Dict[str, Any]
    final_score: Optional[float] = Field(
        default=None,
        description="Per-question weighted final score (text+audio+video).",
    )


class ScoringBlock(BaseModel):
    final_score: float
    breakdown: Dict[str, Optional[float]]
    effective_weights: Dict[str, float]
    modalities: List[str]
    performance_label: str
    feedback_text: str


class CompleteInterviewData(BaseModel):
    role: str
    count: int
    average_scores: Dict[str, float]
    per_question: List[PerQuestionResult]
    scoring: ScoringBlock
