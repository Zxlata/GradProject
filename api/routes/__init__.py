"""FastAPI routers exposing the existing AI pipelines."""

from api.routes import cv, evaluation, health, interview, questions, video

__all__ = ["cv", "evaluation", "health", "interview", "questions", "video"]
