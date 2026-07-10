"""
Text cleaning and lightweight structuring for CV text.

- `clean_text`          : normalize whitespace, strip page markers & control chars
- `structure_cv_text`   : best-effort section splitting by keyword headers
- `extract_key_terms`   : find common tech keywords present in the text
- `extract_contact`     : regex-based email / phone / linkedin extraction

Heavy lifting (accurate skills, role, experience) is delegated to the LLM
in Section 2; this module just prepares clean text and gives cheap signals.
"""

from __future__ import annotations

import re
from typing import Dict, List

from src.utils.logger import get_logger

logger = get_logger(__name__)


# Order matters: earlier keys take priority when ranges overlap.
_SECTION_KEYWORDS: Dict[str, List[str]] = {
    "summary": ["summary", "profile", "objective", "about me"],
    "experience": [
        "experience",
        "employment",
        "work history",
        "professional experience",
    ],
    "education": ["education", "academic", "qualifications"],
    "skills": ["skills", "technical skills", "competencies", "technologies"],
    "projects": ["projects", "portfolio", "personal projects"],
    "certifications": ["certifications", "certificates", "credentials", "licenses"],
    "languages": ["languages"],
    "interests": ["interests", "hobbies"],
}

_TECH_KEYWORDS: List[str] = [
    "python", "javascript", "typescript", "java", "c++", "c#", "go", "rust",
    "sql", "html", "css", "bash",
    "react", "angular", "vue", "next.js", "node.js", "express",
    "django", "flask", "fastapi", "spring", "rails",
    "aws", "azure", "gcp", "docker", "kubernetes", "terraform",
    "machine learning", "deep learning", "nlp", "computer vision",
    "rest api", "graphql",
    "mongodb", "postgresql", "mysql", "redis", "elasticsearch",
    "git", "ci/cd", "jenkins",
    "pandas", "numpy", "pytorch", "tensorflow", "scikit-learn",
]

_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PHONE_RE = re.compile(r"(?:\+?\d[\d\s\-().]{7,}\d)")
_LINKEDIN_RE = re.compile(r"(?:https?://)?(?:www\.)?linkedin\.com/\S+", re.IGNORECASE)
_PAGE_MARKER_RE = re.compile(r"---\s*Page\s+\d+\s*---", re.IGNORECASE)
_MULTI_WS_RE = re.compile(r"\s+")
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


class TextCleaner:
    """Normalize extracted PDF text and provide cheap structural signals."""

    @staticmethod
    def clean_text(raw_text: str) -> str:
        """Collapse whitespace and strip page markers / control characters.

        Preserves letters, digits, punctuation, and common CV symbols
        (@ . , - ( ) : / + # &) so emails, phones, and URLs survive.
        """
        if not raw_text:
            return ""

        text = _PAGE_MARKER_RE.sub(" ", raw_text)
        text = _CONTROL_RE.sub(" ", text)
        text = _MULTI_WS_RE.sub(" ", text).strip()

        logger.info("Cleaned text: %d chars", len(text))
        return text

    @staticmethod
    def structure_cv_text(cleaned_text: str) -> Dict[str, str]:
        """Best-effort split into sections by keyword headers.

        Returns a mapping {section_name: text}. A section's text spans from
        its keyword to the next recognized keyword, so sections are
        non-overlapping.
        """
        if not cleaned_text:
            return {}

        lower = cleaned_text.lower()

        hits: list[tuple[int, str]] = []
        for section, keywords in _SECTION_KEYWORDS.items():
            for kw in keywords:
                idx = lower.find(kw)
                if idx != -1:
                    hits.append((idx, section))
                    break

        if not hits:
            logger.info("No section headers detected")
            return {}

        hits.sort(key=lambda x: x[0])

        sections: Dict[str, str] = {}
        for i, (start, name) in enumerate(hits):
            end = hits[i + 1][0] if i + 1 < len(hits) else len(cleaned_text)
            sections[name] = cleaned_text[start:end].strip()

        logger.info("Detected %d section(s): %s", len(sections), list(sections))
        return sections

    @staticmethod
    def extract_key_terms(text: str) -> List[str]:
        """Return the subset of `_TECH_KEYWORDS` present in `text`."""
        if not text:
            return []

        lower = text.lower()
        found = [kw for kw in _TECH_KEYWORDS if kw in lower]

        seen: set[str] = set()
        unique: List[str] = []
        for kw in found:
            if kw not in seen:
                unique.append(kw)
                seen.add(kw)

        logger.info("Found %d tech keyword(s)", len(unique))
        return unique

    @staticmethod
    def extract_contact(text: str) -> Dict[str, str | None]:
        """Regex-only extraction of email, phone, and LinkedIn URL."""
        if not text:
            return {"email": None, "phone": None, "linkedin": None}

        email = _EMAIL_RE.search(text)
        phone = _PHONE_RE.search(text)
        linkedin = _LINKEDIN_RE.search(text)

        return {
            "email": email.group(0) if email else None,
            "phone": phone.group(0).strip() if phone else None,
            "linkedin": linkedin.group(0) if linkedin else None,
        }
