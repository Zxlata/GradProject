"""
POST /generate-questions — generate an interview question set from a profile.

Uses the existing ``QuestionGenerator.generate_interview_set``
(src/question_generation/question_generator.py), which:

- calls Ollama for CV-tailored questions,
- falls back to the curated bank when the LLM is unavailable,
- enforces a balanced difficulty / type mix.

No model code is duplicated here.
"""

from __future__ import annotations

from fastapi import APIRouter

from api.schemas import ApiResponse
from api.schemas.questions import (
    GenerateQuestionsData,
    GenerateQuestionsRequest,
    Question,
)
from api.services import get_question_generator

router = APIRouter(tags=["questions"])


@router.post(
    "/generate-questions",
    response_model=ApiResponse[GenerateQuestionsData],
)
def generate_questions(
    payload: GenerateQuestionsRequest,
) -> ApiResponse[GenerateQuestionsData]:
    """Generate ``num_questions`` questions from a CV profile dict."""
    questions_raw = get_question_generator().generate_interview_set(
        payload.profile,
        num_questions=payload.num_questions,
    )

    questions = [Question(**q) for q in questions_raw]
    data = GenerateQuestionsData(questions=questions, count=len(questions))
    return ApiResponse.ok(data=data, message="Questions generated")
