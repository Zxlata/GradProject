"""
AI Service - Microservice scaffold (placeholder).

The previous voice-emotion / interview-evaluation model has been removed.
This module exposes the stable HTTP contract that the rest of the platform
already speaks, so a new AI/ML model can be plugged in without touching the
other services.

To integrate a new model:
    1. Implement it in a new module (e.g. ``my_model_service.py``).
    2. Wire it into the handler functions below (``predict_cv_match``,
       ``generate_questions``, ``evaluate_interview``, ``evaluate_answer``).
    3. Update ``requirements.txt`` with any extra dependencies.

Until that happens, every endpoint returns a clean placeholder payload that
keeps the API contract stable for the gateway, the interview-service and the
frontend.
"""

import logging
import os
from datetime import datetime
from typing import Optional

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


app = FastAPI(
    title="AI Interview Service (placeholder)",
    description=(
        "Microservice scaffold ready for a new AI/ML model integration. "
        "Endpoints expose the same contract used by the rest of the platform."
    ),
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


MODEL_LOADED: bool = False


@app.on_event("startup")
async def startup_event() -> None:
    logger.info("AI Service started (placeholder mode).")
    logger.info("No model is currently loaded. Connect a new model in main.py.")


@app.get("/")
async def root() -> dict:
    return {
        "service": "AI Interview Service",
        "status": "placeholder",
        "version": "2.0.0",
        "model_loaded": MODEL_LOADED,
        "message": (
            "Old AI model removed. Integrate a new model by implementing the "
            "endpoints in this service."
        ),
        "endpoints": {
            "predict": "POST /predict",
            "generate_questions": "POST /generate-questions",
            "evaluate_interview": "POST /evaluate-interview",
            "evaluate_answer": "POST /evaluate-answer",
            "health": "GET /health",
        },
    }


@app.get("/health")
async def health_check() -> dict:
    return {
        "status": "healthy",
        "model_loaded": MODEL_LOADED,
        "timestamp": datetime.now().isoformat(),
    }


# --- Future model integration points -------------------------------------------------


@app.post("/predict")
async def predict_cv_match(data: Optional[dict] = None) -> dict:
    """Plug a CV / job-match model in here."""
    payload = data or {}
    return {
        "success": True,
        "prediction": "pending",
        "match_score": None,
        "recommended_questions": [],
        "skills_identified": [],
        "experience_level": "Unknown",
        "interview_type": payload.get("interview_type", "general"),
        "message": (
            "AI model not connected. Integrate a CV/match model in /predict."
        ),
    }


@app.post("/generate-questions")
async def generate_questions(data: Optional[dict] = None) -> dict:
    """Plug a question-generation model in here."""
    payload = data or {}
    return {
        "success": True,
        "questions": [],
        "interview_type": payload.get("interview_type", "general"),
        "message": (
            "AI model not connected. Integrate a question-generation model in "
            "/generate-questions."
        ),
    }


@app.post("/evaluate-interview")
async def evaluate_interview(data: Optional[dict] = None) -> dict:
    """Plug a full-interview evaluation model in here."""
    payload = data or {}
    questions = payload.get("questions", []) or []
    answers = payload.get("answers", []) or []
    return {
        "success": True,
        "overall_score": 0,
        "strengths": [],
        "improvements": [],
        "overall_feedback": (
            "AI model not connected. Returning empty evaluation. "
            f"Received {len(questions)} questions and {len(answers)} answers."
        ),
        "answer_scores": [],
    }


@app.post("/evaluate-answer")
async def evaluate_answer(data: Optional[dict] = None) -> dict:
    """Plug a single-answer evaluation model in here."""
    return {
        "success": True,
        "score": 0,
        "feedback": "AI model not connected. Integrate an evaluator in /evaluate-answer.",
    }


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5004))
    logger.info("Starting AI Service placeholder on port %s", port)
    uvicorn.run(
        "main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=port,
        reload=False,
        log_level=os.getenv("LOG_LEVEL", "info").lower(),
    )
