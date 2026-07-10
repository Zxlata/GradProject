"""
Service layer for the API.

These helpers do **not** reimplement any AI logic. They just hold cached
singletons of the existing classes from ``src/`` and expose tiny pass-through
helpers used by the route handlers.
"""

from api.services.singletons import (
    get_answer_evaluator,
    get_answer_pipeline,
    get_cv_analyzer,
    get_cv_parser,
    get_ollama_client,
    get_question_generator,
    get_scoring_engine,
    save_upload,
)

__all__ = [
    "get_answer_evaluator",
    "get_answer_pipeline",
    "get_cv_analyzer",
    "get_cv_parser",
    "get_ollama_client",
    "get_question_generator",
    "get_scoring_engine",
    "save_upload",
]
