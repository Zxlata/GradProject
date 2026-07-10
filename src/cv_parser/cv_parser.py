"""
End-to-end CV parsing pipeline.

Flow:
    PDF path
        -> PDFExtractor.extract_text            (raw text)
        -> TextCleaner.clean_text               (normalized text)
        -> TextCleaner.structure_cv_text        (section map)
        -> TextCleaner.extract_key_terms        (tech keywords)
        -> TextCleaner.extract_contact          (email / phone / linkedin)
        -> dict result

LLM-based structured extraction (name, role, experience_years, ...) is
handled later by `src.llm_integration` so this module has no network
dependencies and is fast + deterministic.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

from src.cv_parser.pdf_extractor import PDFExtractor
from src.cv_parser.text_cleaner import TextCleaner
from src.utils.logger import get_logger

logger = get_logger(__name__)


class CVParser:
    """Parse a CV PDF into a structured dict."""

    def __init__(self) -> None:
        self.extractor = PDFExtractor()
        self.cleaner = TextCleaner()

    def parse_cv(self, pdf_path: str | Path) -> Dict[str, Any]:
        """Parse a CV PDF into structured text + cheap signals.

        Returns a dict with this shape on success::

            {
                "status": "success",
                "source": "<pdf path>",
                "raw_text": "...",
                "cleaned_text": "...",
                "sections": {"experience": "...", "skills": "..."},
                "keywords": ["python", "aws", ...],
                "contact": {"email": "...", "phone": "...", "linkedin": "..."},
            }

        On failure, returns ``{"status": "error", "message": "..."}`` — callers
        never have to wrap this in a try/except for common I/O issues.
        """
        try:
            raw_text = self.extractor.extract_text(pdf_path)
            cleaned = self.cleaner.clean_text(raw_text)
            sections = self.cleaner.structure_cv_text(cleaned)
            keywords = self.cleaner.extract_key_terms(cleaned)
            contact = self.cleaner.extract_contact(cleaned)

            logger.info(
                "CV parsed: %d sections, %d keywords, contact=%s",
                len(sections),
                len(keywords),
                {k: bool(v) for k, v in contact.items()},
            )

            return {
                "status": "success",
                "source": str(pdf_path),
                "raw_text": raw_text,
                "cleaned_text": cleaned,
                "sections": sections,
                "keywords": keywords,
                "contact": contact,
            }

        except FileNotFoundError as e:
            logger.error("CV not found: %s", e)
            return {"status": "error", "message": str(e)}
        except Exception as e:
            logger.exception("CV parsing failed")
            return {"status": "error", "message": str(e)}
