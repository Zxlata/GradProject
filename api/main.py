"""
FastAPI entrypoint for the AI Mock Interview System.

This module wires up the API layer that sits **alongside** the existing
Streamlit app — it imports and reuses the project's classes (``CVParser``,
``CVAnalyzer``, ``QuestionGenerator``, ``AnswerEvaluator``, ``ScoringEngine``,
``AnswerPipeline``) without modifying any AI/ML code.

Run with::

    uvicorn api.main:app --reload --port 8000

Endpoints:

    GET  /health                — service + Ollama status
    POST /analyze-cv            — upload PDF, return structured profile
    POST /generate-questions    — profile -> question set
    POST /evaluate-answer       — single Q/A grading
    POST /complete-interview    — batch grading + multimodal final score
    POST /analyze-video         — single video answer through AnswerPipeline
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api.routes import cv, evaluation, health, interview, questions, video
from api.schemas import ApiResponse

logger = logging.getLogger("api")


# --------------------------------------------------------------------------- #
# App setup
# --------------------------------------------------------------------------- #

app = FastAPI(
    title="AI Mock Interview API",
    description=(
        "REST layer over the existing AI mock interview pipelines "
        "(CV parsing, question generation, answer evaluation, multimodal "
        "scoring, video analysis). Designed to be consumed by an existing "
        "website backend."
    ),
    version="1.0.0",
)


# CORS — open by default so any frontend / backend can call the API during
# integration. Restrict ``allow_origins`` to the production domains before
# shipping (e.g. ``["https://yourapp.com"]``).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------- #
# Routers
# --------------------------------------------------------------------------- #

app.include_router(health.router)
app.include_router(cv.router)
app.include_router(questions.router)
app.include_router(evaluation.router)
app.include_router(interview.router)
app.include_router(video.router)


# --------------------------------------------------------------------------- #
# Unified error handling
#
# Every error response uses the same envelope as success responses so the
# frontend / backend client only needs one parser:
#
#   { "success": false, "message": "...", "data": null, "errors": [...] }
# --------------------------------------------------------------------------- #


def _envelope(message: str, errors: List[Any], status_code: int) -> JSONResponse:
    body = ApiResponse.fail(message=message, errors=errors).model_dump()
    return JSONResponse(status_code=status_code, content=body)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    _request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Pydantic validation errors -> 422 with structured details."""
    errors: List[Dict[str, Any]] = []
    for err in exc.errors():
        errors.append(
            {
                "code": "validation_error",
                "field": ".".join(str(p) for p in err.get("loc", [])),
                "message": err.get("msg", "Invalid value"),
                "type": err.get("type"),
            }
        )
    return _envelope("Request validation failed", errors, status_code=422)


@app.exception_handler(HTTPException)
async def http_exception_handler(_request: Request, exc: HTTPException) -> JSONResponse:
    """Standard HTTPException -> envelope (preserves status code + headers)."""
    detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
    body = ApiResponse.fail(
        message=detail,
        errors=[{"code": f"http_{exc.status_code}", "message": detail}],
    ).model_dump()
    return JSONResponse(
        status_code=exc.status_code,
        content=body,
        headers=getattr(exc, "headers", None),
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(
    _request: Request, exc: Exception
) -> JSONResponse:
    """Last-resort handler — never leak tracebacks to clients."""
    logger.exception("Unhandled exception in API: %s", exc)
    return _envelope(
        "Internal server error",
        [{"code": "internal_error", "message": str(exc)}],
        status_code=500,
    )


# --------------------------------------------------------------------------- #
# Root
# --------------------------------------------------------------------------- #


@app.get("/", tags=["health"], response_model=ApiResponse[Dict[str, Any]])
def root() -> ApiResponse[Dict[str, Any]]:
    """Tiny landing payload — useful for quick reachability checks."""
    return ApiResponse.ok(
        data={
            "service": "ai-mock-interview-api",
            "version": app.version,
            "docs_url": "/docs",
            "openapi_url": "/openapi.json",
        },
        message="AI Mock Interview API is running",
    )
