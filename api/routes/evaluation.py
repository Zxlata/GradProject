"""
POST /evaluate-answer — grade a single (question, answer) pair.

Uses ``AnswerEvaluator.evaluate_answer`` (src/evaluation/answer_evaluator.py)
which itself runs:

    1. ``AnswerValidator``  — heuristic relevance / length checks
    2. ``RelevanceScorer``  — optional Ollama semantic relevance
    3. ``_grade_with_llm``  — Ollama JSON grading
    4. fallback envelopes when any of the above fail

No model logic is duplicated here.
"""

from __future__ import annotations

from fastapi import APIRouter

from api.schemas import ApiResponse
from api.schemas.evaluation import (
    EvaluateAnswerData,
    EvaluateAnswerRequest,
    Evaluation,
)
from api.services import get_answer_evaluator

router = APIRouter(tags=["evaluation"])


@router.post(
    "/evaluate-answer",
    response_model=ApiResponse[EvaluateAnswerData],
)
def evaluate_answer(
    payload: EvaluateAnswerRequest,
) -> ApiResponse[EvaluateAnswerData]:
    """Score a single answer with the existing evaluator pipeline."""
    evaluation_dict = get_answer_evaluator().evaluate_answer(
        question=payload.question,
        answer=payload.answer,
        role=payload.role,
    )

    overall = (
        float(evaluation_dict.get("correctness_score", 0))
        + float(evaluation_dict.get("clarity_score", 0))
        + float(evaluation_dict.get("completeness_score", 0))
    ) / 3.0

    data = EvaluateAnswerData(
        question=payload.question,
        answer=payload.answer,
        role=payload.role,
        evaluation=Evaluation(**evaluation_dict),
        overall_text_score=round(overall, 2),
    )
    return ApiResponse.ok(data=data, message="Answer evaluated")
