"""
Interview question generator.

- Uses the LLM (Ollama) when available for CV-tailored questions.
- Falls back to a curated question bank when Ollama is down or errors out.
- Avoids duplicates inside a single interview set.
- Returns questions as structured dicts ready for the UI and evaluator.
"""

from __future__ import annotations

import random
from typing import Any, Dict, List, Optional, Tuple

from src.llm_integration.ollama_client import OllamaClient
from src.llm_integration.prompts import PromptTemplates
from src.question_generation.difficulty_levels import (
    DIFFICULTIES,
    FALLBACK_QUESTIONS,
    build_distribution,
    normalize_difficulty,
)
from src.utils.logger import get_logger

logger = get_logger(__name__)

# Interview types understood by the prompt builder. The fallback bank only has
# "technical" / "behavioral", so hr/mixed are mapped onto those buckets below.
INTERVIEW_TYPES = ("technical", "behavioral", "hr", "mixed")

# Values that mean "no explicit role — infer it from the CV + JD".
_AUTO_ROLE_VALUES = {"", "auto", "auto detect", "auto-detect", "autodetect", "any", "none"}

# Preference keys read from an explicit ``preferences`` dict OR from ``cv_data``
# itself (the MERN backend may fold preferences straight into the profile).
_PREF_KEYS = ("role", "interview_type", "difficulty", "language", "job_description")

# Per-question focus angles, rotated across an interview set so the LLM spreads
# questions across skills / projects / experience / JD requirements instead of
# clustering on one topic (see "INTERVIEW SET QUALITY" requirement).
_FOCUS_ANGLES: Dict[str, Tuple[str, ...]] = {
    "technical": (
        "a specific skill or technology listed in the CV or job description",
        "the candidate's most relevant project and the decisions behind it",
        "system design and architecture for a realistic requirement",
        "debugging or troubleshooting a production incident",
        "performance optimization and scalability trade-offs",
        "data modeling, API design, or integration concerns",
        "testing, reliability, or security / authentication",
    ),
    "behavioral": (
        "teamwork and cross-functional collaboration",
        "handling conflict with a teammate or stakeholder",
        "ownership and leading without formal authority",
        "a real failure and the lessons learned from it",
        "delivering under pressure or a tight deadline",
        "learning a new technology or domain quickly",
    ),
    "hr": (
        "motivation and why this specific role / company",
        "key strengths backed by concrete evidence",
        "a genuine weakness and how it is being addressed",
        "short-term and long-term career goals",
        "company culture fit and preferred work style",
        "expectations around growth, environment, and availability",
    ),
}


def _focus_angle(question_type: str, index: int) -> str:
    """Pick a rotating focus angle for the ``index``-th question of a type."""
    angles = _FOCUS_ANGLES.get(question_type) or _FOCUS_ANGLES["technical"]
    return angles[index % len(angles)]


def normalize_interview_type(value: str | None) -> str:
    """Return a valid interview type, defaulting to 'technical'."""
    if value and value.strip().lower() in INTERVIEW_TYPES:
        return value.strip().lower()
    return "technical"


def resolve_role(value: str | None) -> Optional[str]:
    """Return an explicit role string, or ``None`` to signal auto-detect."""
    if value and value.strip().lower() not in _AUTO_ROLE_VALUES:
        return value.strip()
    return None


class QuestionGenerator:
    """Generate interview questions from a CV profile."""

    def __init__(
        self,
        client: Optional[OllamaClient] = None,
        rng: Optional[random.Random] = None,
    ) -> None:
        self.client = client or OllamaClient()
        self._rng = rng or random.Random()

    # ------------------------------------------------------------------ #
    # Single question
    # ------------------------------------------------------------------ #

    def generate_question(
        self,
        cv_data: Dict[str, Any],
        difficulty: str = "medium",
        question_type: str = "technical",
        *,
        role: Optional[str] = None,
        job_description: Optional[str] = None,
        language: str = "english",
        avoid: Optional[List[str]] = None,
        focus: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Generate one interview question, personalized to the candidate/job.

        ``role`` / ``job_description`` / ``language`` are passed straight to the
        prompt builder; ``avoid`` is a list of already-asked questions used to
        keep an interview set diverse. Returns a dict::

            {
                "text": "...",
                "difficulty": "easy|medium|hard",
                "type": "technical|behavioral|hr|mixed",
                "source": "llm" | "fallback"
            }
        """
        difficulty = normalize_difficulty(difficulty)
        question_type = normalize_interview_type(question_type)

        if self.client.is_server_running():
            text = self._generate_via_llm(
                cv_data,
                difficulty,
                question_type,
                role=role,
                job_description=job_description,
                language=language,
                avoid=avoid,
                focus=focus,
            )
            if text:
                return {
                    "text": text,
                    "difficulty": difficulty,
                    "type": question_type,
                    "source": "llm",
                }
            logger.warning("LLM returned no usable question; falling back")

        return {
            "text": self._pick_fallback(difficulty, question_type),
            "difficulty": difficulty,
            "type": question_type,
            "source": "fallback",
        }

    def _generate_via_llm(
        self,
        cv_data: Dict[str, Any],
        difficulty: str,
        question_type: str,
        *,
        role: Optional[str] = None,
        job_description: Optional[str] = None,
        language: str = "english",
        avoid: Optional[List[str]] = None,
        focus: Optional[str] = None,
    ) -> Optional[str]:
        prompt = PromptTemplates.generate_question(
            cv_data,
            difficulty,
            question_type,
            role=role,
            job_description=job_description,
            language=language,
            avoid=avoid,
            focus=focus,
        )
        resp = self.client.generate(prompt, temperature=0.8)

        if "error" in resp:
            logger.warning("LLM error: %s", resp["error"])
            return None

        text = (resp.get("response") or "").strip()
        return self._clean_question(text) if text else None

    @staticmethod
    def _clean_question(text: str) -> str:
        """Strip surrounding quotes, bullets, numbering, and trailing noise."""
        text = text.strip()
        for prefix in ("Q:", "Question:", "-", "*"):
            if text.lower().startswith(prefix.lower()):
                text = text[len(prefix) :].lstrip()

        while text[:2].rstrip(". ").isdigit():
            text = text.split(None, 1)[-1] if " " in text else text

        if len(text) >= 2 and text[0] == text[-1] and text[0] in ('"', "'"):
            text = text[1:-1].strip()

        return text.split("\n\n")[0].strip()

    def _fallback_bucket(self, question_type: str) -> str:
        """Map an interview type onto an available fallback bank bucket.

        The curated bank only has ``technical`` / ``behavioral`` questions, so
        ``hr`` reuses the behavioral bank and ``mixed`` picks one at random.
        """
        if question_type in ("behavioral", "hr"):
            return "behavioral"
        if question_type == "mixed":
            return self._rng.choice(("technical", "behavioral"))
        return "technical"

    def _pick_fallback(self, difficulty: str, question_type: str) -> str:
        bucket = self._fallback_bucket(question_type)
        return self._rng.choice(FALLBACK_QUESTIONS[bucket][difficulty])

    # ------------------------------------------------------------------ #
    # Interview set
    # ------------------------------------------------------------------ #

    def generate_interview_set(
        self,
        cv_data: Dict[str, Any],
        num_questions: int = 5,
        *,
        preferences: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        """Generate `num_questions` questions, personalized via `preferences`.

        ``preferences`` may carry ``role``, ``interview_type``, ``difficulty``,
        ``language`` and ``job_description``. The same fields are also read from
        ``cv_data`` when not supplied explicitly, so the MERN backend can fold
        them into the profile dict. When no preferences are present the legacy
        balanced easy→hard / technical↔behavioral mix is used.

        Each returned question carries a 1-based `id` and `status: "pending"`.
        Already-asked questions are passed to the LLM (``avoid``) and duplicate
        texts are retried with a different fallback to keep the set varied.
        """
        prefs = self._resolve_preferences(cv_data, preferences)
        role = resolve_role(prefs.get("role"))
        language = prefs.get("language") or "english"
        job_description = prefs.get("job_description")

        plan = self._build_plan(
            num_questions,
            difficulty_pref=prefs.get("difficulty"),
            type_pref=prefs.get("interview_type"),
            personalized=prefs.get("_personalized", False),
        )

        seen: set[str] = set()
        questions: List[Dict[str, Any]] = []
        # Rotate focus angles independently per interview type so each topic
        # bucket cycles through its own variety of angles.
        type_counts: Dict[str, int] = {}

        for idx, (difficulty, q_type) in enumerate(plan, start=1):
            focus = None
            if prefs.get("_personalized"):
                pos = type_counts.get(q_type, 0)
                type_counts[q_type] = pos + 1
                focus = _focus_angle(q_type, pos)

            q = self.generate_question(
                cv_data,
                difficulty,
                q_type,
                role=role,
                job_description=job_description,
                language=language,
                avoid=list(seen),
                focus=focus,
            )

            if q["text"] in seen:
                retry = self._pick_fallback(difficulty, q_type)
                if retry not in seen:
                    q = {**q, "text": retry, "source": "fallback"}

            q.update({"id": idx, "status": "pending"})
            questions.append(q)
            seen.add(q["text"])

        logger.info(
            "Generated %d questions (sources: %s)",
            len(questions),
            {q["source"] for q in questions},
        )
        return questions

    # ------------------------------------------------------------------ #
    # Preference resolution + planning
    # ------------------------------------------------------------------ #

    @staticmethod
    def _resolve_preferences(
        cv_data: Dict[str, Any],
        preferences: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Merge explicit preferences with any folded into ``cv_data``.

        Sets ``_personalized`` when at least one preference field is present so
        the planner knows to honor it instead of the legacy distribution.
        """
        explicit = preferences or {}
        resolved: Dict[str, Any] = {}
        for key in _PREF_KEYS:
            resolved[key] = explicit.get(key) or cv_data.get(key)
        # Common aliases the backend might use.
        resolved["role"] = resolved["role"] or explicit.get("target_role") or cv_data.get("target_role")
        resolved["job_description"] = (
            resolved["job_description"]
            or explicit.get("jd")
            or cv_data.get("jd")
        )
        resolved["_personalized"] = any(resolved.get(k) for k in _PREF_KEYS)
        return resolved

    def _build_plan(
        self,
        num_questions: int,
        *,
        difficulty_pref: Optional[str] = None,
        type_pref: Optional[str] = None,
        personalized: bool = False,
    ) -> List[Tuple[str, str]]:
        """Return a list of ``(difficulty, interview_type)`` of length n.

        - When not personalized, defer to the legacy balanced distribution.
        - A fixed ``difficulty`` (easy/medium/hard) is applied to every question.
        - A fixed ``interview_type`` (technical/behavioral/hr) is applied to all;
          ``mixed`` (or unset) spreads across technical → behavioral → hr.
        """
        if num_questions <= 0:
            return []
        if not personalized:
            return build_distribution(num_questions)

        # --- difficulty axis ---------------------------------------------- #
        d = (difficulty_pref or "").strip().lower()
        if d in DIFFICULTIES:
            difficulties = [d] * num_questions
        else:
            ladder = ("easy", "medium", "hard")
            difficulties = [ladder[i % len(ladder)] for i in range(num_questions)]

        # --- interview-type axis ------------------------------------------ #
        t = (type_pref or "").strip().lower()
        if t in ("technical", "behavioral", "hr"):
            types = [t] * num_questions
        elif t == "mixed":  # intentionally alternate technical <-> behavioral
            cycle = ("technical", "behavioral")
            types = [cycle[i % len(cycle)] for i in range(num_questions)]
        else:  # unspecified -> balanced spread across all soft + hard skills
            cycle = ("technical", "behavioral", "hr")
            types = [cycle[i % len(cycle)] for i in range(num_questions)]

        return list(zip(difficulties, types))
