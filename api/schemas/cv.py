"""Schemas for the CV analysis endpoint."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class CVProfile(BaseModel):
    """Mirrors the dict returned by ``CVAnalyzer.analyze`` (kept loose)."""

    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    current_role: Optional[str] = None
    experience_years: Optional[int] = None
    skills: List[str] = Field(default_factory=list)
    education: List[Any] = Field(default_factory=list)
    languages: List[str] = Field(default_factory=list)
    source: Optional[str] = Field(
        default=None,
        description="One of: llm | ollama_down | llm_parse_failed | parse_error",
    )


class AnalyzeCVData(BaseModel):
    """Payload for /analyze-cv responses."""

    profile: CVProfile
    saved_path: str = Field(..., description="Server-side path of the saved upload.")
    parse: Dict[str, Any] = Field(
        default_factory=dict,
        description="Raw output from CVParser.parse_cv (sections, keywords, contact, ...).",
    )
