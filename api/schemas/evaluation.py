"""Schemas for single-answer evaluation."""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class EvaluateAnswerRequest(BaseModel):
    question: str = Field(..., min_length=1)
    answer: str = Field(..., description="Candidate answer (may be empty).")
    role: str = Field(default="Software Engineer")


class Evaluation(BaseModel):
    """Mirrors AnswerEvaluator's canonical evaluation envelope."""

    correctness_score: float
    clarity_score: float
    completeness_score: float
    strengths: List[str] = []
    areas_to_improve: List[str] = []
    detailed_feedback: str = ""
    source: str = Field(
        ..., description="'llm' | 'fallback:<reason>' | 'fallback:irrelevant:<reason>'"
    )


class EvaluateAnswerData(BaseModel):
    question: str
    answer: str
    role: str
    evaluation: Evaluation
    overall_text_score: Optional[float] = Field(
        default=None,
        description="Average of the three text sub-scores (0-100), for convenience.",
    )
