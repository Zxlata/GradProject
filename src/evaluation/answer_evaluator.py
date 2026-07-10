"""
LLM-based interview answer evaluator.

Takes (question, answer) and returns three scores in [0, 100] plus optional
strengths / areas to improve / feedback. When the LLM is unavailable or its
output can't be parsed, a deterministic length-based heuristic is used so
downstream code always gets a usable dict.

The scoring schema used across the project:

    {
        "correctness_score":   0-100,
        "clarity_score":       0-100,
        "completeness_score":  0-100,
        "strengths":           [str, ...],
        "areas_to_improve":    [str, ...],
        "detailed_feedback":   str,
        "source":              "llm" | "fallback"
    }
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

import config
from src.evaluation.answer_validator import (
    AnswerValidator,
    build_semantic_relevance_envelope,
)
from src.evaluation.relevance_scorer import RelevanceScorer
from src.llm_integration.json_parser import JSONParser
from src.llm_integration.ollama_client import OllamaClient
from src.llm_integration.prompts import PromptTemplates
from src.utils.helpers import clamp
from src.utils.logger import get_logger

logger = get_logger(__name__)


_REQUIRED_SCORE_KEYS = (
    "correctness_score",
    "clarity_score",
    "completeness_score",
)


class AnswerEvaluator:
    """Evaluate a single interview answer, or a full Q&A set."""

    def __init__(
        self,
        client: Optional[OllamaClient] = None,
        validator: Optional[AnswerValidator] = None,
        relevance_scorer: Optional[RelevanceScorer] = None,
        *,
        relevance_enabled: Optional[bool] = None,
    ) -> None:
        self.client = client or OllamaClient()
        # The validator runs before any LLM call to short-circuit nonsense
        # / irrelevant / too-short answers. Injectable for testing.
        self.validator = validator or AnswerValidator()
        if relevance_enabled is None:
            self._relevance_enabled: bool = bool(
                config.RELEVANCE_LLM_ENABLED
            )
        else:
            self._relevance_enabled = bool(relevance_enabled)
        self._relevance_scorer: RelevanceScorer = (
            relevance_scorer or RelevanceScorer(self.client)
        )

    # ------------------------------------------------------------------ #
    # Single answer
    # ------------------------------------------------------------------ #

    def evaluate_answer(
        self,
        question: str,
        answer: str,
        role: str = "Software Engineer",
    ) -> Dict[str, Any]:
        """Evaluate one (question, answer) pair.

        Always returns a complete dict. `source` distinguishes LLM vs fallback.
        """
        answer = (answer or "").strip()

        # Heuristic pre-LLM guard (no network) — empty / very short / weak
        # token overlap. Returns a ready-to-use envelope.
        validation = self.validator.validate(question, answer)
        if not validation.is_valid and validation.evaluation is not None:
            logger.info(
                "Skipping LLM evaluation — validator rejected answer (%s)",
                validation.reason,
            )
            return validation.evaluation

        # Optional semantic relevance call (Ollama) *before* the grader
        if self._relevance_enabled and self.client.is_server_running():
            by_id = self._relevance_scorer.score_pairs([(1, question, answer)])
            if by_id and 1 in by_id:
                r = by_id[1]
                sim = float(r.get("similarity", 0.0))
                expl = str(r.get("explanation") or "")
                if sim < float(config.RELEVANCE_MIN_SIMILARITY):
                    logger.info(
                        "Skipping grader — semantic relevance %.2f < %.2f",
                        sim,
                        config.RELEVANCE_MIN_SIMILARITY,
                    )
                    return build_semantic_relevance_envelope(sim, expl)
            # Parse failure: fail open and continue to the grader

        if not self.client.is_server_running():
            logger.warning("Ollama not running; using fallback evaluation")
            return self._fallback(answer, reason="ollama_down")

        return self._grade_with_llm(question, answer, role=role)

    # ------------------------------------------------------------------ #
    # Batch
    # ------------------------------------------------------------------ #

    def evaluate_multiple_answers(
        self,
        qa_pairs: List[Dict[str, str]],
        role: str = "Software Engineer",
    ) -> Dict[str, Any]:
        """Evaluate a list of `{question, answer}` dicts.

        Returns::

            {
                "individual": [ {question, answer, evaluation}, ... ],
                "average_scores": {
                    "correctness_score": float,
                    "clarity_score": float,
                    "completeness_score": float
                },
                "count": int
            }
        """
        individual: List[Dict[str, Any]] = []
        totals = {k: 0.0 for k in _REQUIRED_SCORE_KEYS}

        n = len(qa_pairs)
        pre: List[Optional[Dict[str, Any]]] = [None] * n

        for i, pair in enumerate(qa_pairs):
            q = pair.get("question", "")
            a = pair.get("answer", "")
            v = self.validator.validate(q, a)
            if not v.is_valid and v.evaluation is not None:
                pre[i] = v.evaluation

        valid_idx = [i for i in range(n) if pre[i] is None]
        rel_by_idx: Dict[int, Dict[str, Any]] = {}
        if (
            self._relevance_enabled
            and self.client.is_server_running()
            and valid_idx
        ):
            rpairs: List[Tuple[int, str, str]] = []
            for j, vi in enumerate(valid_idx, start=1):
                p = qa_pairs[vi]
                rpairs.append(
                    (j, p.get("question", ""), p.get("answer", ""))
                )
            scored = self._relevance_scorer.score_pairs(rpairs)
            if scored:
                for j, vi in enumerate(valid_idx, start=1):
                    if j in scored:
                        rel_by_idx[vi] = scored[j]

        for i, pair in enumerate(qa_pairs):
            q = pair.get("question", "")
            a = pair.get("answer", "")

            if pre[i] is not None:
                evaluation = pre[i]  # type: ignore[assignment]
            else:
                block = rel_by_idx.get(i)
                sim = (
                    float(block.get("similarity", 0.0))
                    if block
                    else 1.0
                )
                if (
                    block is not None
                    and sim < float(config.RELEVANCE_MIN_SIMILARITY)
                ):
                    expl = str(block.get("explanation") or "")
                    evaluation = build_semantic_relevance_envelope(
                        sim, expl
                    )
                elif not self.client.is_server_running():
                    logger.warning("Ollama not running; using fallback evaluation")
                    evaluation = self._fallback(a, reason="ollama_down")
                else:
                    evaluation = self._grade_with_llm(q, a, role=role)

            for k in _REQUIRED_SCORE_KEYS:
                totals[k] += float(evaluation.get(k, 0.0))

            individual.append(
                {"question": q, "answer": a, "evaluation": evaluation}
            )

        count = len(qa_pairs)
        averages = (
            {k: round(totals[k] / count, 2) for k in _REQUIRED_SCORE_KEYS}
            if count
            else {k: 0.0 for k in _REQUIRED_SCORE_KEYS}
        )

        return {
            "individual": individual,
            "average_scores": averages,
            "count": count,
        }

    # ------------------------------------------------------------------ #
    # Internals
    # ------------------------------------------------------------------ #

    def _grade_with_llm(
        self,
        question: str,
        answer: str,
        *,
        role: str = "Software Engineer",
    ) -> Dict[str, Any]:
        """Main grader (scores 0-100) — not the relevance check."""
        prompt = PromptTemplates.evaluate_answer(
            question, answer, role=role
        )
        resp = self.client.generate(prompt, temperature=0.3)

        if "error" in resp:
            logger.warning("LLM error during evaluation: %s", resp["error"])
            return self._fallback(answer, reason="llm_error")

        parsed = JSONParser.extract_json(resp.get("response", ""))
        if parsed is None or not JSONParser.validate_json_structure(
            parsed, _REQUIRED_SCORE_KEYS
        ):
            logger.warning("Malformed LLM evaluation output; using fallback")
            return self._fallback(answer, reason="llm_parse_failed")

        return self._normalize(parsed)

    @staticmethod
    def _normalize(data: Dict[str, Any]) -> Dict[str, Any]:
        """Coerce LLM output into the canonical evaluation shape."""

        def _num(key: str) -> float:
            value = data.get(key, 0)
            try:
                return clamp(float(value), 0.0, 100.0)
            except (TypeError, ValueError):
                return 50.0

        def _str_list(key: str) -> List[str]:
            value = data.get(key) or []
            if isinstance(value, str):
                value = [value]
            if not isinstance(value, list):
                return []
            return [str(v).strip() for v in value if v and str(v).strip()]

        return {
            "correctness_score": _num("correctness_score"),
            "clarity_score": _num("clarity_score"),
            "completeness_score": _num("completeness_score"),
            "strengths": _str_list("strengths"),
            "areas_to_improve": _str_list("areas_to_improve"),
            "detailed_feedback": str(data.get("detailed_feedback") or "").strip(),
            "source": "llm",
        }

    @staticmethod
    def _fallback(answer: str, reason: str) -> Dict[str, Any]:
        """Cheap length-based heuristic when the LLM can't help.

        The numbers intentionally avoid extremes so the final weighted
        score stays in a reasonable mid-range.
        """
        words = len(answer.split()) if answer else 0

        if words == 0:
            correctness, clarity, completeness = 0, 0, 0
            feedback = "No answer was provided."
        elif words < 15:
            correctness, clarity, completeness = 30, 40, 25
            feedback = "The answer is very short — try to expand with concrete details."
        elif words < 50:
            correctness, clarity, completeness = 55, 60, 50
            feedback = "Reasonable length but could include more specifics or examples."
        elif words < 150:
            correctness, clarity, completeness = 70, 70, 70
            feedback = "Good length and structure. Make sure every point is on-topic."
        else:
            correctness, clarity, completeness = 65, 60, 75
            feedback = "Very thorough. Consider tightening the response so it stays focused."

        return {
            "correctness_score": float(correctness),
            "clarity_score": float(clarity),
            "completeness_score": float(completeness),
            "strengths": [] if words == 0 else ["Provided an answer"],
            "areas_to_improve": [
                "Add specific examples" if words and words < 150 else "Tighten the response"
            ]
            if words
            else ["Answer the question"],
            "detailed_feedback": feedback,
            "source": f"fallback:{reason}",
        }
