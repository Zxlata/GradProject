"""Schemas for the question generation endpoint."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from config import DEFAULT_NUM_QUESTIONS


class GenerateQuestionsRequest(BaseModel):
    """Input to /generate-questions.

    The ``profile`` dict accepts any subset of fields produced by
    ``CVAnalyzer.analyze`` — only ``skills`` / ``current_role`` /
    ``experience_years`` are actually read by the prompt builder.
    """

    profile: Dict[str, Any] = Field(
        default_factory=dict,
        description="CV profile dict (output of /analyze-cv.profile).",
    )
    num_questions: int = Field(
        default=DEFAULT_NUM_QUESTIONS, ge=1, le=10
    )


class Question(BaseModel):
    id: int
    text: str
    difficulty: str
    type: str
    source: str = Field(..., description="'llm' or 'fallback'.")
    status: Optional[str] = "pending"


class GenerateQuestionsData(BaseModel):
    questions: List[Question]
    count: int
