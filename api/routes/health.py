"""
Health check endpoints.

Reports whether the FastAPI process itself is alive and whether the local
Ollama LLM server is reachable. Whisper / wav2vec2 / MediaPipe / DeepFace are
lazily loaded on first use, so we don't probe them here.
"""

from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter

from api.schemas import ApiResponse
from api.services import get_ollama_client
from config import EMOTION_MODEL_NAME, OLLAMA_BASE_URL, OLLAMA_MODEL, WHISPER_MODEL_SIZE

router = APIRouter(tags=["health"])


@router.get("/health", response_model=ApiResponse[Dict[str, Any]])
def health() -> ApiResponse[Dict[str, Any]]:
    """Basic liveness + Ollama reachability."""
    client = get_ollama_client()
    ollama_up = client.is_server_running()
    models = client.list_models() if ollama_up else []

    payload: Dict[str, Any] = {
        "status": "ok",
        "service": "ai-mock-interview-api",
        "ollama": {
            "url": OLLAMA_BASE_URL,
            "default_model": OLLAMA_MODEL,
            "running": ollama_up,
            "available_models": models,
        },
        "models": {
            "whisper_size": WHISPER_MODEL_SIZE,
            "speech_emotion": EMOTION_MODEL_NAME,
            "facial_emotion": "deepface (lazy)",
            "face_tracker": "mediapipe (lazy)",
        },
    }
    return ApiResponse.ok(data=payload, message="API is healthy")
