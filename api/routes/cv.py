"""
POST /analyze-cv — upload a PDF CV and get a structured profile.

Pipeline (existing project code, called as-is):

    1. ``CVParser.parse_cv``   (src/cv_parser/cv_parser.py)
       -> raw_text, cleaned_text, sections, keywords, contact

    2. ``CVAnalyzer.analyze`` (src/llm_integration/cv_analyzer.py)
       -> LLM-extracted profile (name / role / skills / ...) with a
          deterministic regex fallback when Ollama is unreachable.

No new ML logic is added here.
"""

from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, UploadFile, status

from api.schemas import ApiResponse
from api.schemas.cv import AnalyzeCVData, CVProfile
from api.services import get_cv_analyzer, get_cv_parser, save_upload
from config import UPLOADS_DIR

router = APIRouter(tags=["cv"])

_ALLOWED_CONTENT_TYPES = {"application/pdf", "application/x-pdf"}


@router.post("/analyze-cv", response_model=ApiResponse[AnalyzeCVData])
async def analyze_cv(file: UploadFile = File(...)) -> ApiResponse[AnalyzeCVData]:
    """Parse + LLM-analyse a CV PDF.

    Returns the structured profile plus the raw parser output (sections /
    keywords / contact) so a frontend can show both views.
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only .pdf files are accepted.",
        )
    if file.content_type and file.content_type not in _ALLOWED_CONTENT_TYPES:
        # Some browsers send 'application/octet-stream' — only reject when the
        # content type is set AND it's clearly not a PDF.
        if not file.content_type.endswith("octet-stream"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported content type: {file.content_type}",
            )

    saved_path = save_upload(
        file.file, file.filename, UPLOADS_DIR, fallback_extension=".pdf"
    )

    # 1. Local parsing (no network).
    parse_result = get_cv_parser().parse_cv(str(saved_path))
    if parse_result.get("status") != "success":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=parse_result.get("message") or "Failed to parse CV.",
        )

    # 2. LLM-driven structured profile (with regex/keyword fallback).
    profile_dict = get_cv_analyzer().analyze(parse_result)

    data = AnalyzeCVData(
        profile=CVProfile(**profile_dict),
        saved_path=str(saved_path),
        parse={
            "sections": list((parse_result.get("sections") or {}).keys()),
            "keywords": parse_result.get("keywords") or [],
            "contact": parse_result.get("contact") or {},
            "cleaned_text": parse_result.get("cleaned_text") or "",
        },
    )
    return ApiResponse.ok(data=data, message="CV analysed successfully")
