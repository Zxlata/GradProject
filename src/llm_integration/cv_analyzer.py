"""
Bridge between `src.cv_parser` and the LLM.

Takes the cleaned/structured output of `CVParser.parse_cv()` and asks the
LLM to produce a normalized CV profile (name, role, skills, etc).

If the LLM is unreachable or returns malformed output, a deterministic
fallback profile is built from the regex + keyword signals the parser
already extracted — so downstream modules always get usable data.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from src.llm_integration.ollama_client import OllamaClient
from src.llm_integration.prompts import PromptTemplates
from src.utils.logger import get_logger

logger = get_logger(__name__)


_EXPECTED_KEYS = ("name", "email", "phone", "current_role", "skills")


class CVAnalyzer:
    """Turn raw/cleaned CV text into a structured profile via the LLM."""

    def __init__(self, client: Optional[OllamaClient] = None) -> None:
        self.client = client or OllamaClient()

    def analyze(self, cv_parse_result: Dict[str, Any]) -> Dict[str, Any]:
        """Analyze a dict returned by ``CVParser.parse_cv``.

        Always returns a profile dict. When the LLM is available and well
        behaved the result is LLM-derived; otherwise the fallback profile
        (built from regex + keywords) is returned and marked accordingly.
        """
        if cv_parse_result.get("status") != "success":
            logger.warning("CV parse did not succeed; returning empty profile")
            return self._empty_profile(source="parse_error")

        cleaned_text: str = cv_parse_result.get("cleaned_text", "")
        contact: Dict[str, Any] = cv_parse_result.get("contact") or {}
        keywords: List[str] = cv_parse_result.get("keywords") or []

        if not self.client.is_server_running():
            logger.warning("Ollama not running; using heuristic fallback profile")
            return self._fallback_profile(contact, keywords, source="ollama_down")

        prompt = PromptTemplates.extract_cv_data(cleaned_text)
        data = self.client.generate_json(prompt, temperature=0.2)

        if data is None:
            logger.warning("LLM returned unparsable output; using fallback profile")
            return self._fallback_profile(contact, keywords, source="llm_parse_failed")

        profile = self._normalize(data)
        profile = self._fill_from_signals(profile, contact, keywords)
        profile["source"] = "llm"
        return profile

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #

    @staticmethod
    def _empty_profile(source: str) -> Dict[str, Any]:
        return {
            "name": None,
            "email": None,
            "phone": None,
            "current_role": None,
            "experience_years": None,
            "skills": [],
            "education": [],
            "languages": [],
            "source": source,
        }

    @classmethod
    def _fallback_profile(
        cls,
        contact: Dict[str, Any],
        keywords: List[str],
        source: str,
    ) -> Dict[str, Any]:
        profile = cls._empty_profile(source=source)
        profile.update(
            {
                "email": contact.get("email"),
                "phone": contact.get("phone"),
                "skills": list(keywords)[:15],
            }
        )
        return profile

    @staticmethod
    def _normalize(data: Dict[str, Any]) -> Dict[str, Any]:
        """Coerce LLM output into the canonical profile shape."""
        skills = data.get("skills") or []
        if not isinstance(skills, list):
            skills = []
        skills = [str(s).strip() for s in skills if s and str(s).strip()]

        education = data.get("education") or []
        if isinstance(education, dict):
            education = [education]
        if not isinstance(education, list):
            education = []

        languages = data.get("languages") or []
        if not isinstance(languages, list):
            languages = []

        return {
            "name": data.get("name"),
            "email": data.get("email"),
            "phone": data.get("phone"),
            "current_role": data.get("current_role"),
            "experience_years": data.get("experience_years"),
            "skills": skills[:15],
            "education": education,
            "languages": languages,
        }

    @staticmethod
    def _fill_from_signals(
        profile: Dict[str, Any],
        contact: Dict[str, Any],
        keywords: List[str],
    ) -> Dict[str, Any]:
        """Fill nulls with regex/keyword signals from the parser."""
        if not profile.get("email"):
            profile["email"] = contact.get("email")
        if not profile.get("phone"):
            profile["phone"] = contact.get("phone")
        if not profile.get("skills"):
            profile["skills"] = list(keywords)[:15]
        return profile
