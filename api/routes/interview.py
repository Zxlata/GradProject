"""
POST /complete-interview — batch-evaluate a full Q&A set and compute the
final weighted score across text + audio + video modalities.

Reuses, untouched:

- ``AnswerEvaluator.evaluate_multiple_answers``  (text grading + averaging)
- ``ScoringEngine.calculate_final_score``        (multimodal weighted fusion)
- ``ScoringEngine.performance_label``            (band label)
- ``ScoringEngine.generate_feedback``            (deterministic feedback report)

The endpoint accepts optional aggregate audio/video metrics so the existing
website backend can submit metrics it already computed (e.g. via
/analyze-video) for a true multimodal final score. Per-question metrics are
also accepted to compute per-question final scores, matching what the
Streamlit Results page renders today.
"""

from __future__ import annotations

from typing import Dict, List, Optional

from fastapi import APIRouter

from api.schemas import ApiResponse
from api.schemas.interview import (
    CompleteInterviewData,
    CompleteInterviewRequest,
    PerQuestionResult,
    ScoringBlock,
)
from api.services import get_answer_evaluator, get_scoring_engine

router = APIRouter(tags=["interview"])


@router.post(
    "/complete-interview",
    response_model=ApiResponse[CompleteInterviewData],
)
def complete_interview(
    payload: CompleteInterviewRequest,
) -> ApiResponse[CompleteInterviewData]:
    """Run batch evaluation + multimodal final scoring."""
    evaluator = get_answer_evaluator()
    engine = get_scoring_engine()

    qa_pairs = [{"question": p.question, "answer": p.answer} for p in payload.pairs]

    # 1. Text grading for the full set.
    eval_result = evaluator.evaluate_multiple_answers(qa_pairs, role=payload.role)

    # 2. Aggregate metrics — explicit values from the request take priority,
    # otherwise we average whatever per-question metrics the caller supplied.
    avg_audio = payload.avg_audio_metrics or _average_metric_dicts(
        [p.audio_metrics for p in payload.pairs]
    )
    avg_video = payload.avg_video_metrics or _average_metric_dicts(
        [p.video_metrics for p in payload.pairs]
    )

    # 3. Per-question final score (text+audio+video where available).
    per_question: List[PerQuestionResult] = []
    for pair, item in zip(payload.pairs, eval_result["individual"], strict=True):
        per_q = engine.calculate_final_score(
            text_evaluation=item["evaluation"],
            audio_metrics=pair.audio_metrics or avg_audio,
            video_metrics=pair.video_metrics or avg_video,
        )
        per_question.append(
            PerQuestionResult(
                question=item["question"],
                answer=item["answer"],
                evaluation=item["evaluation"],
                final_score=per_q["final_score"],
            )
        )

    # 4. Overall weighted score across the whole interview.
    overall = engine.calculate_final_score(
        text_evaluation=eval_result["average_scores"],
        audio_metrics=avg_audio,
        video_metrics=avg_video,
    )
    label = engine.performance_label(overall["final_score"])
    feedback_text = engine.generate_feedback(overall)

    scoring = ScoringBlock(
        final_score=overall["final_score"],
        breakdown=overall["breakdown"],
        effective_weights=overall["effective_weights"],
        modalities=overall["modalities"],
        performance_label=label,
        feedback_text=feedback_text,
    )

    data = CompleteInterviewData(
        role=payload.role,
        count=eval_result["count"],
        average_scores=eval_result["average_scores"],
        per_question=per_question,
        scoring=scoring,
    )
    return ApiResponse.ok(data=data, message="Interview evaluated")


# --------------------------------------------------------------------------- #
# Local helpers (no model logic)
# --------------------------------------------------------------------------- #


def _average_metric_dicts(
    rows: List[Optional[Dict[str, float]]],
) -> Optional[Dict[str, float]]:
    """Average per-question metric dicts, ignoring ``None`` entries.

    Mirrors ``main._average_audio_metrics`` / ``_average_video_metrics`` but
    works on whatever keys are present (audio uses 4, video uses up to 3).
    """
    cleaned = [r for r in rows if r]
    if not cleaned:
        return None
    keys = {k for row in cleaned for k in row.keys()}
    out: Dict[str, float] = {}
    for k in keys:
        values = [
            float(r[k])
            for r in cleaned
            if isinstance(r.get(k), (int, float))
        ]
        if values:
            out[k] = sum(values) / len(values)
    return out or None
