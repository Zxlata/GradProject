"""
Difficulty / question-type definitions and distribution logic.

Kept separate from `question_generator.py` so the mix can evolve without
touching LLM or fallback code. The fallback question bank also lives here.
"""

from __future__ import annotations

from typing import Dict, List, Tuple

Difficulty = str  # "easy" | "medium" | "hard"
QuestionType = str  # "technical" | "behavioral"

DIFFICULTIES: Tuple[Difficulty, ...] = ("easy", "medium", "hard")
QUESTION_TYPES: Tuple[QuestionType, ...] = ("technical", "behavioral")


def normalize_difficulty(value: str | None) -> Difficulty:
    """Return a valid difficulty, defaulting to 'medium' for unknown inputs."""
    if value and value.lower() in DIFFICULTIES:
        return value.lower()
    return "medium"


def normalize_question_type(value: str | None) -> QuestionType:
    """Return a valid question type, defaulting to 'technical' for unknown inputs."""
    if value and value.lower() in QUESTION_TYPES:
        return value.lower()
    return "technical"


def build_distribution(num_questions: int) -> List[Tuple[Difficulty, QuestionType]]:
    """Return a list of `(difficulty, type)` tuples of length `num_questions`.

    The base template progresses easy → hard and alternates technical /
    behavioral. For sets larger than the template length it cycles through.
    """
    if num_questions <= 0:
        return []

    template: List[Tuple[Difficulty, QuestionType]] = [
        ("easy", "technical"),
        ("easy", "behavioral"),
        ("medium", "technical"),
        ("medium", "behavioral"),
        ("hard", "technical"),
        ("hard", "behavioral"),
    ]

    return [template[i % len(template)] for i in range(num_questions)]


# --------------------------------------------------------------------------- #
# Fallback question bank
# --------------------------------------------------------------------------- #

FALLBACK_QUESTIONS: Dict[QuestionType, Dict[Difficulty, List[str]]] = {
    "technical": {
        "easy": [
            "What is a variable and why is it important?",
            "Explain the difference between a list and a dictionary.",
            "What is a function and why do we use them?",
            "What is an API in simple terms?",
            "Explain what a database is.",
        ],
        "medium": [
            "How would you approach optimizing a slow database query?",
            "Explain the main principles of object-oriented programming.",
            "What is the difference between synchronous and asynchronous code?",
            "Walk me through how you would design a simple login system.",
            "What is a REST API and how does it work?",
        ],
        "hard": [
            "How would you design a system that can serve millions of users?",
            "Explain microservices architecture and the main trade-offs.",
            "How would you introduce caching to improve application performance?",
            "Describe the CAP theorem and its practical implications.",
            "How do you handle transactions across multiple services?",
        ],
    },
    "behavioral": {
        "easy": [
            "Tell me about yourself.",
            "Why are you interested in this position?",
            "What are your main strengths?",
            "Describe a project you were proud of.",
            "What is something you would like to improve about yourself?",
        ],
        "medium": [
            "Tell me about a time you faced a difficult technical problem.",
            "Describe a situation where you had to collaborate with a difficult teammate.",
            "Tell me about a failure and what you learned from it.",
            "How do you handle pressure and tight deadlines?",
            "Describe a time you had to learn something new quickly.",
        ],
        "hard": [
            "Tell me about a time you disagreed with your manager.",
            "Describe your most significant professional achievement.",
            "How do you handle conflicting priorities from different stakeholders?",
            "Tell me about a time you had to lead a project without formal authority.",
            "Describe a situation where you mentored someone and it was challenging.",
        ],
    },
}
