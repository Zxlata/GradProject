"""
Safe extraction and validation of JSON objects embedded in LLM text.

LLMs frequently wrap JSON in prose, code fences, or trailing commentary.
This module:

- Strips ``` code fences
- Parses directly if possible
- Falls back to the first balanced ``{ ... }`` object in the text
- Provides structure validation and numeric score clamping
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, Iterable, Optional

from src.utils.helpers import clamp
from src.utils.logger import get_logger

logger = get_logger(__name__)


_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)


class JSONParser:
    """Parse and validate JSON produced by LLMs."""

    # ------------------------------------------------------------------ #
    # Extraction
    # ------------------------------------------------------------------ #

    @staticmethod
    def extract_json(text: str) -> Optional[Dict[str, Any]]:
        """Best-effort JSON extraction from free-form text.

        Returns ``None`` if no valid JSON object can be recovered.
        """
        if not text or not text.strip():
            return None

        candidate = JSONParser._strip_code_fence(text).strip()

        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass

        balanced = JSONParser._find_balanced_object(candidate)
        if balanced is None:
            logger.warning("No JSON object found in LLM response")
            return None

        try:
            parsed = json.loads(balanced)
            if isinstance(parsed, dict):
                return parsed
            logger.warning("Parsed JSON is not an object")
            return None
        except json.JSONDecodeError as e:
            logger.error("Failed to parse extracted JSON: %s", e)
            return None

    @staticmethod
    def _strip_code_fence(text: str) -> str:
        """Return inner content of the first ```...``` block, or text unchanged."""
        match = _FENCE_RE.search(text)
        return match.group(1) if match else text

    @staticmethod
    def _find_balanced_object(text: str) -> Optional[str]:
        """Return the first top-level ``{ ... }`` object with balanced braces.

        Brace-aware and string-aware (ignores braces inside "..." with escapes).
        """
        start = text.find("{")
        if start == -1:
            return None

        depth = 0
        in_string = False
        escape = False

        for i in range(start, len(text)):
            ch = text[i]

            if in_string:
                if escape:
                    escape = False
                elif ch == "\\":
                    escape = True
                elif ch == '"':
                    in_string = False
                continue

            if ch == '"':
                in_string = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return text[start : i + 1]

        return None

    # ------------------------------------------------------------------ #
    # Validation / sanitization
    # ------------------------------------------------------------------ #

    @staticmethod
    def validate_json_structure(data: Any, required_keys: Iterable[str]) -> bool:
        """True iff `data` is a dict containing every key in `required_keys`."""
        if not isinstance(data, dict):
            logger.error("Data is not a dict")
            return False

        missing = [k for k in required_keys if k not in data]
        if missing:
            logger.warning("Missing required keys: %s", missing)
            return False
        return True

    @staticmethod
    def sanitize_scores(
        scores: Dict[str, Any], lo: float = 0.0, hi: float = 100.0
    ) -> Dict[str, Any]:
        """Clamp every numeric value in `scores` to [lo, hi]."""
        out: Dict[str, Any] = {}
        for key, value in scores.items():
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                out[key] = clamp(float(value), lo, hi)
            else:
                out[key] = value
        return out
