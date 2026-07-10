"""
REST API layer for the AI Mock Interview System.

This package exposes the existing AI/ML pipelines (CV parsing, LLM analysis,
question generation, answer evaluation, multimodal scoring, video analysis)
as a FastAPI service. It is purely additive: the Streamlit app, the
``src/`` packages, and the model logic are imported as-is and never modified.

Run with::

    uvicorn api.main:app --reload --port 8000
"""
