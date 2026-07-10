"""
Cached singletons for the existing AI/ML classes.

We import the real classes from ``src/`` and the existing ``main.py`` flow
unchanged. Each ``get_*`` function returns a single shared instance so models
(Whisper, wav2vec2, MediaPipe, DeepFace) are not reloaded on every request.

NO model logic is defined here — these are thin factories around the same
objects ``main.py`` already caches with ``st.cache_resource``.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import BinaryIO

# All imports below are the existing project classes — same as `main.py`.
from src.cv_parser.cv_parser import CVParser
from src.evaluation.answer_evaluator import AnswerEvaluator
from src.evaluation.scoring import ScoringEngine
from src.interview.answer_pipeline import AnswerPipeline
from src.llm_integration.cv_analyzer import CVAnalyzer
from src.llm_integration.ollama_client import OllamaClient
from src.question_generation.question_generator import QuestionGenerator
from src.utils.helpers import safe_filename, timestamp_slug
from src.utils.logger import get_logger

logger = get_logger(__name__)


# --------------------------------------------------------------------------- #
# Cached AI services
# --------------------------------------------------------------------------- #


@lru_cache(maxsize=1)
def get_ollama_client() -> OllamaClient:
    """Single shared Ollama HTTP client (no model loading happens here)."""
    return OllamaClient()


@lru_cache(maxsize=1)
def get_cv_parser() -> CVParser:
    """Local PDF parser (PyMuPDF + regex). Lightweight, no network."""
    return CVParser()


@lru_cache(maxsize=1)
def get_cv_analyzer() -> CVAnalyzer:
    """Wraps the LLM call that turns parsed CV text into a structured profile."""
    return CVAnalyzer(client=get_ollama_client())


@lru_cache(maxsize=1)
def get_question_generator() -> QuestionGenerator:
    """LLM-first / fallback question generator."""
    return QuestionGenerator(client=get_ollama_client())


@lru_cache(maxsize=1)
def get_answer_evaluator() -> AnswerEvaluator:
    """Validator -> RelevanceScorer -> LLM grader pipeline."""
    return AnswerEvaluator(client=get_ollama_client())


@lru_cache(maxsize=1)
def get_scoring_engine() -> ScoringEngine:
    """Deterministic multimodal weighted scorer."""
    return ScoringEngine()


@lru_cache(maxsize=1)
def get_answer_pipeline() -> AnswerPipeline:
    """End-to-end video answer analyser (Whisper + wav2vec2 + MediaPipe + DeepFace)."""
    return AnswerPipeline()


# --------------------------------------------------------------------------- #
# Upload helper
# --------------------------------------------------------------------------- #


def save_upload(
    stream: BinaryIO,
    original_name: str,
    target_dir: Path,
    fallback_extension: str = "",
) -> Path:
    """Persist an uploaded file to ``target_dir`` with a timestamp-prefixed name.

    Mirrors how ``main.py`` saves CV uploads and answer videos so artifacts
    coming through the API live in the same folders the Streamlit app uses.
    """
    target_dir.mkdir(parents=True, exist_ok=True)
    base = safe_filename(original_name or "") or f"upload{fallback_extension}"
    if fallback_extension and "." not in base:
        base = f"{base}{fallback_extension}"
    path = target_dir / f"{timestamp_slug()}_{base}"
    with open(path, "wb") as f:
        f.write(stream.read())
    return path
