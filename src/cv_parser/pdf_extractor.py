"""
PDF text extraction using PyMuPDF.

Two extraction modes:
- `extract_text`          : all pages joined into a single string
- `extract_text_per_page` : dict of {page_number: text}
"""

from __future__ import annotations

from pathlib import Path
from typing import Dict

import fitz  # PyMuPDF

from src.utils.logger import get_logger

logger = get_logger(__name__)


class PDFExtractor:
    """Extract text from PDF files."""

    SUPPORTED_EXTENSIONS = {".pdf"}

    def _validate(self, pdf_path: str | Path) -> Path:
        path = Path(pdf_path)
        if not path.exists():
            raise FileNotFoundError(f"PDF file not found: {path}")
        if path.suffix.lower() not in self.SUPPORTED_EXTENSIONS:
            raise ValueError(
                f"Unsupported file type '{path.suffix}'. Expected one of "
                f"{sorted(self.SUPPORTED_EXTENSIONS)}"
            )
        return path

    def extract_text(self, pdf_path: str | Path) -> str:
        """Return all text in the PDF, concatenated with page markers."""
        path = self._validate(pdf_path)
        logger.info("Extracting text from %s", path)

        parts: list[str] = []
        with fitz.open(path) as doc:
            for i, page in enumerate(doc, start=1):
                parts.append(f"\n--- Page {i} ---\n")
                parts.append(page.get_text())

        text = "".join(parts)
        logger.info("Extracted %d characters from %s", len(text), path.name)
        return text

    def extract_text_per_page(self, pdf_path: str | Path) -> Dict[int, str]:
        """Return {page_number: text} with 1-based page numbers."""
        path = self._validate(pdf_path)
        logger.info("Extracting per-page text from %s", path)

        pages: Dict[int, str] = {}
        with fitz.open(path) as doc:
            for i, page in enumerate(doc, start=1):
                pages[i] = page.get_text()

        logger.info("Extracted %d page(s) from %s", len(pages), path.name)
        return pages
