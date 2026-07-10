"""
Final scoring: combine text, audio, and video signals into one score.

Design:

- **Weights** come from ``config.SCORE_WEIGHTS`` (default 50/30/20).
- **Modalities** (audio, video) are *optional*. When a modality is missing,
  its weight is redistributed over the modalities that *are* present.
  This way a text-only interview still scores 0-100 without artificial zeros.
- **Feedback** is a small, deterministic text report with a performance
  label and a breakdown; no LLM dependency so it always works.

Expected input shapes::

    text_evaluation = {
        "correctness_score": 0-100,
        "clarity_score":     0-100,
        "completeness_score": 0-100,
    }

    audio_metrics = {
        # Any subset of these. All in 0-100 unless specified.
        "confidence_score": float,
        "clarity_score":    float,
        "pacing_score":     float,
        "energy_score":     float,
    }

    video_metrics = {
        "eye_contact_score": float,   # 0-1 OR 0-100 (auto-detected)
        "engagement_score":  float,   # 0-100
        "emotion_stability": float,   # 0-100
    }
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from config import SCORE_WEIGHTS
from src.utils.helpers import clamp
from src.utils.logger import get_logger

logger = get_logger(__name__)


# Sub-weights inside each modality
_AUDIO_WEIGHTS = {
    "confidence_score": 0.4,
    "clarity_score": 0.3,
    "pacing_score": 0.2,
    "energy_score": 0.1,
}

_VIDEO_WEIGHTS = {
    "eye_contact_score": 0.4,
    "engagement_score": 0.4,
    "emotion_stability": 0.2,
}


class ScoringEngine:
    """Combine per-modality metrics into a final 0-100 score."""

    def __init__(self, weights: Optional[Dict[str, float]] = None) -> None:
        self.weights = dict(weights or SCORE_WEIGHTS)
        self._validate_weights()

    def _validate_weights(self) -> None:
        missing = {"text", "audio", "video"} - set(self.weights)
        if missing:
            raise ValueError(f"Missing weight keys: {sorted(missing)}")
        total = sum(self.weights.values())
        if abs(total - 1.0) > 1e-6:
            raise ValueError(f"Weights must sum to 1.0, got {total}")

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #

    def calculate_final_score(
        self,
        text_evaluation: Optional[Dict[str, Any]] = None,
        audio_metrics: Optional[Dict[str, Any]] = None,
        video_metrics: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Compute the final weighted score and breakdown.

        Returns a dict::

            {
                "final_score":      0-100,
                "breakdown":        {"text": float, "audio": float|None, "video": float|None},
                "effective_weights": {"text": w, "audio": w, "video": w},  # after redistribution
                "modalities":       ["text", ...],                         # which were present
            }
        """
        sub_scores: Dict[str, Optional[float]] = {
            "text": self._calculate_text_score(text_evaluation),
            "audio": self._calculate_audio_score(audio_metrics),
            "video": self._calculate_video_score(video_metrics),
        }
        present = [k for k, v in sub_scores.items() if v is not None]
        effective = self._redistribute_weights(present)

        if not present:
            logger.warning("No modalities provided; final_score=0")
            return {
                "final_score": 0.0,
                "breakdown": sub_scores,
                "effective_weights": effective,
                "modalities": [],
            }

        weighted_sum = sum(sub_scores[m] * effective[m] for m in present)  # type: ignore[operator]
        final = clamp(weighted_sum, 0.0, 100.0)

        logger.info(
            "Final score=%.2f over modalities=%s (weights=%s)",
            final,
            present,
            {k: round(v, 3) for k, v in effective.items() if v > 0},
        )

        return {
            "final_score": round(final, 2),
            "breakdown": {
                m: round(sub_scores[m], 2) if sub_scores[m] is not None else None
                for m in ("text", "audio", "video")
            },
            "effective_weights": effective,
            "modalities": present,
        }

    def generate_feedback(self, scoring_data: Dict[str, Any]) -> str:
        """Build a short, deterministic feedback report from `calculate_final_score`."""
        final = float(scoring_data.get("final_score", 0.0))
        label = self.performance_label(final)
        comment = self._performance_comment(final)
        breakdown = scoring_data.get("breakdown") or {}
        modalities = scoring_data.get("modalities") or []

        lines = [
            "=== INTERVIEW FEEDBACK ===",
            "",
            f"Overall Performance: {label}",
            f"Final Score: {final}/100",
            "",
            comment,
            "",
            "SCORE BREAKDOWN:",
        ]
        for modality in ("text", "audio", "video"):
            value = breakdown.get(modality)
            if value is None:
                lines.append(f"- {modality.capitalize()}: not analyzed")
            else:
                lines.append(f"- {modality.capitalize()}: {value:.1f}/100")

        lines.append("")
        lines.append("MODALITIES INCLUDED: " + (", ".join(modalities) or "none"))
        lines.append("")
        lines.append("RECOMMENDATIONS:")
        lines.extend(self._recommendations(final, modalities))

        return "\n".join(lines)

    @staticmethod
    def performance_label(score: float) -> str:
        if score >= 90:
            return "Excellent"
        if score >= 80:
            return "Very Good"
        if score >= 70:
            return "Good"
        if score >= 60:
            return "Acceptable"
        return "Needs Improvement"

    # ------------------------------------------------------------------ #
    # Per-modality scoring
    # ------------------------------------------------------------------ #

    @staticmethod
    def _calculate_text_score(text_evaluation: Optional[Dict[str, Any]]) -> Optional[float]:
        if not text_evaluation:
            return None
        raw = [
            text_evaluation.get("correctness_score"),
            text_evaluation.get("clarity_score"),
            text_evaluation.get("completeness_score"),
        ]
        values = [clamp(float(v), 0.0, 100.0) for v in raw if isinstance(v, (int, float))]
        if not values:
            return None
        return clamp(sum(values) / len(values), 0.0, 100.0)

    @staticmethod
    def _calculate_audio_score(audio_metrics: Optional[Dict[str, Any]]) -> Optional[float]:
        return _weighted_subscore(audio_metrics, _AUDIO_WEIGHTS)

    @staticmethod
    def _calculate_video_score(video_metrics: Optional[Dict[str, Any]]) -> Optional[float]:
        if not video_metrics:
            return None

        # `eye_contact_score` may arrive as 0-1 or 0-100; normalize to 0-100.
        normalized = dict(video_metrics)
        eye = normalized.get("eye_contact_score")
        if isinstance(eye, (int, float)) and eye <= 1.0:
            normalized["eye_contact_score"] = float(eye) * 100.0

        return _weighted_subscore(normalized, _VIDEO_WEIGHTS)

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #

    def _redistribute_weights(self, present: list[str]) -> Dict[str, float]:
        """Return weights summing to 1.0 only over `present` modalities."""
        effective = {"text": 0.0, "audio": 0.0, "video": 0.0}
        if not present:
            return effective

        total = sum(self.weights[m] for m in present)
        if total <= 0:
            share = 1.0 / len(present)
            for m in present:
                effective[m] = share
            return effective

        for m in present:
            effective[m] = self.weights[m] / total
        return effective

    @staticmethod
    def _performance_comment(score: float) -> str:
        if score >= 90:
            return "Outstanding performance. You communicated clearly and confidently."
        if score >= 80:
            return "Strong performance. Your answers were well-structured and focused."
        if score >= 70:
            return "Solid interview. Keep tightening clarity and adding specifics."
        if score >= 60:
            return "Acceptable. Work on structure, confidence, and concrete examples."
        return "Needs more preparation. Focus on clarity, structure, and relevant depth."

    @staticmethod
    def _recommendations(score: float, modalities: list[str]) -> list[str]:
        recs: list[str] = []
        if score < 70:
            recs.append("1. Use the STAR format for behavioral questions.")
            recs.append("2. Practice answering out loud before the real interview.")
            recs.append("3. Include concrete metrics and specific examples.")
        else:
            recs.append("1. Keep refining answers with data and trade-offs.")
            recs.append("2. Continue practicing to stay consistent under pressure.")

        if "audio" not in modalities:
            recs.append("3. Record yourself speaking to add audio feedback later.")
        if "video" not in modalities:
            recs.append("4. Record on video to get body-language feedback later.")

        return recs


# --------------------------------------------------------------------------- #
# Module-level helpers
# --------------------------------------------------------------------------- #


def _weighted_subscore(
    metrics: Optional[Dict[str, Any]],
    weights: Dict[str, float],
) -> Optional[float]:
    """Weighted mean over the keys in `weights` that are present & numeric.

    Missing keys are skipped and the remaining weights are renormalized.
    Returns None if no numeric values are available.
    """
    if not metrics:
        return None

    present: Dict[str, float] = {}
    for key, w in weights.items():
        value = metrics.get(key)
        if isinstance(value, (int, float)):
            present[key] = clamp(float(value), 0.0, 100.0)

    if not present:
        return None

    total_weight = sum(weights[k] for k in present) or 1.0
    total = sum(present[k] * (weights[k] / total_weight) for k in present)
    return clamp(total, 0.0, 100.0)
