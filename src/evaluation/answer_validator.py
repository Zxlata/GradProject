"""
Relevance / sanity validation for interview answers.

Runs **before** :class:`~src.evaluation.answer_evaluator.AnswerEvaluator`
calls the LLM. Catches the three obvious failure modes that otherwise
produce hallucinated praise from the grader:

1. **Empty / whitespace** — nothing to grade.
2. **Too short** — a one-word reply like "ok" can't be a real answer.
3. **Irrelevant** — answer shares no meaningful content tokens with the
   question, and token-level Jaccard similarity sits below a soft floor.

All checks are pure Python, deterministic, and free of external
dependencies so the validator can run on every submission without
touching the network. A ``similarity_fn`` seam is exposed so richer
embeddings (e.g. ``sentence-transformers``) can be plugged in later.

Public surface:

- :data:`STOPWORDS`         — English stopword set used for tokenisation
- :func:`extract_keywords`  — token extractor (stopword + punctuation stripped)
- :func:`token_jaccard`     — default similarity function (token overlap)
- :class:`ValidationResult` — dataclass returned by :meth:`AnswerValidator.validate`
- :class:`AnswerValidator`  — composable validator
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterable, List, Optional, Set, Tuple

from config import (
    ANSWER_MIN_CONTENT_WORDS,
    ANSWER_MIN_KEYWORD_OVERLAP,
    ANSWER_MIN_SIMILARITY,
    ANSWER_MIN_WORDS,
)
from src.utils.logger import get_logger

logger = get_logger(__name__)


# --------------------------------------------------------------------------- #
# Tokenisation
# --------------------------------------------------------------------------- #

#: Compact English stopword set — enough to strip filler from typical
#: interview questions and answers without killing real content words.
STOPWORDS: Set[str] = {
    "a", "an", "the",
    "i", "you", "he", "she", "we", "they", "it", "me", "him", "her", "us",
    "them", "my", "your", "his", "its", "our", "their", "mine", "yours",
    "am", "is", "are", "was", "were", "be", "been", "being",
    "do", "does", "did", "doing", "done",
    "have", "has", "had", "having",
    "can", "could", "would", "should", "will", "shall", "may", "might", "must",
    "and", "or", "but", "if", "then", "else", "so", "because", "as", "than",
    "in", "on", "at", "by", "for", "with", "about", "against", "between",
    "into", "through", "during", "before", "after", "above", "below", "to",
    "from", "up", "down", "out", "off", "over", "under", "again", "further",
    "of", "this", "that", "these", "those",
    "what", "which", "who", "whom", "whose",
    "how", "when", "where", "why",
    "not", "no", "nor", "only", "own", "same", "such", "too", "very",
    "just", "also", "any", "some", "each", "other", "more", "most", "few",
    "here", "there", "now", "ever", "never",
    "please", "thanks", "thank",
}

#: Extra words stripped only from **questions**. These are interview-prompt
#: filler verbs that dominate similarity if counted; they can however be
#: real content words inside an answer ("hash maps *give* O(1) lookups"),
#: so we keep them when tokenising the candidate's reply.
QUESTION_FILLERS: Set[str] = {
    "describe", "explain", "tell", "share", "give", "provide", "discuss",
    "mention", "example", "examples", "briefly",
}

_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9'+#\-]*")


def _normalise_token(tok: str) -> str:
    """Lowercase + strip trailing plural/gerund/tense markers (cheap lemma)."""
    t = tok.lower()
    # Handle common English inflections so "technologies" ≈ "technology".
    # Ordered longest-first so "technologies" hits "ies" before "s".
    for suffix, replacement in (
        ("'s", ""),
        ("ies", "y"),
        ("ing", ""),
        ("ed", ""),
        ("es", ""),
        ("s", ""),
    ):
        if t.endswith(suffix) and len(t) > len(suffix) + 2:
            t = t[: -len(suffix)] + replacement
            break
    return t


def extract_keywords(
    text: str,
    *,
    stopwords: Optional[Set[str]] = None,
    extra_stopwords: Optional[Set[str]] = None,
    min_length: int = 3,
) -> List[str]:
    """Tokenise ``text`` into meaningful content words.

    Lowercases, strips punctuation, drops stopwords + numbers, de-duplicates
    while preserving order, and applies a cheap English inflection fixer so
    "technologies" / "technology" collapse together.

    ``extra_stopwords`` lets callers extend the default set without losing
    it — e.g. :class:`AnswerValidator` adds :data:`QUESTION_FILLERS` only
    when tokenising a question.
    """
    stop = stopwords if stopwords is not None else STOPWORDS
    if extra_stopwords:
        stop = stop | extra_stopwords
    seen: Set[str] = set()
    out: List[str] = []
    for raw in _TOKEN_RE.findall(text or ""):
        if len(raw) < min_length:
            continue
        norm = _normalise_token(raw)
        if not norm or norm in stop or norm.isdigit():
            continue
        if norm in seen:
            continue
        seen.add(norm)
        out.append(norm)
    return out


def _tokens_match(a: str, b: str, min_prefix: int = 3) -> bool:
    """True if two normalised tokens should count as the same concept.

    Exact match, or one is a substring of the other **and** the shorter token
    is at least ``min_prefix`` characters. Lets ``web`` ↔ ``website`` match
    without the false positives that a pure prefix check would produce.
    """
    if a == b:
        return True
    short, long_ = (a, b) if len(a) <= len(b) else (b, a)
    return len(short) >= min_prefix and short in long_


def count_keyword_overlap(
    question_keywords: Iterable[str],
    answer_keywords: Iterable[str],
) -> int:
    """How many question keywords the answer actually engages with."""
    answer_list = list(answer_keywords)
    hits = 0
    for qk in question_keywords:
        if any(_tokens_match(qk, ak) for ak in answer_list):
            hits += 1
    return hits


def token_jaccard(
    question_keywords: Iterable[str],
    answer_keywords: Iterable[str],
) -> float:
    """Lightweight similarity: |Q ∩ A| / |Q ∪ A| with fuzzy token equality."""
    q = list(question_keywords)
    a = list(answer_keywords)
    if not q and not a:
        return 0.0

    matched_q: Set[int] = set()
    matched_a: Set[int] = set()
    for qi, qk in enumerate(q):
        for ai, ak in enumerate(a):
            if ai in matched_a:
                continue
            if _tokens_match(qk, ak):
                matched_q.add(qi)
                matched_a.add(ai)
                break

    union = len(q) + len(a) - len(matched_q)
    return len(matched_q) / union if union else 0.0


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #


#: Internal reason codes surfaced via ``ValidationResult.reason`` and
#: the evaluator's ``source`` string (``fallback:irrelevant:<reason>``).
REASON_EMPTY = "empty"
REASON_TOO_SHORT = "too_short"
REASON_NO_KEYWORD_OVERLAP = "no_keyword_overlap"
REASON_LOW_SIMILARITY = "low_similarity"
# LLM relevance pre-check (RelevanceScorer) — not used by the heuristic path
REASON_SEMANTIC_RELEVANCE = "semantic_relevance"


@dataclass
class ValidationResult:
    """Outcome of pre-LLM relevance checks."""

    is_valid: bool
    reason: Optional[str] = None
    word_count: int = 0
    question_keywords: Tuple[str, ...] = field(default_factory=tuple)
    answer_keywords: Tuple[str, ...] = field(default_factory=tuple)
    overlap_count: int = 0
    similarity: float = 0.0
    #: Pre-built evaluation envelope when ``is_valid`` is ``False``. Shares
    #: the exact shape ``AnswerEvaluator`` emits so callers can return it
    #: as-is.
    evaluation: Optional[Dict[str, Any]] = None


class AnswerValidator:
    """Guard clause for :class:`AnswerEvaluator`.

    Parameters
    ----------
    min_words:
        Below this word count, the answer is rejected as ``too_short``.
    min_keyword_overlap:
        Minimum number of question keywords the answer must engage with.
    min_similarity:
        Minimum token-Jaccard similarity. Applied in addition to the
        keyword check, which is why we can keep both tight without too
        many false positives.
    min_content_words:
        Safety valve for the relevance checks: if the answer already has
        this many meaningful (post-stopword) content tokens it bypasses
        the overlap + similarity cuts and goes to the LLM anyway. This
        protects substantive answers that happen to use different
        vocabulary than the question (e.g. *"Hash maps, O(1) lookups"*
        vs *"favorite data structure"*).
    similarity_fn:
        Test seam / extension point — swap in a real embedding-based
        similarity if desired. Must accept two ``Iterable[str]`` of
        normalised keywords and return a float in ``[0, 1]``.
    """

    def __init__(
        self,
        min_words: int = ANSWER_MIN_WORDS,
        min_keyword_overlap: int = ANSWER_MIN_KEYWORD_OVERLAP,
        min_similarity: float = ANSWER_MIN_SIMILARITY,
        min_content_words: int = ANSWER_MIN_CONTENT_WORDS,
        similarity_fn: Optional[
            Callable[[Iterable[str], Iterable[str]], float]
        ] = None,
    ) -> None:
        self.min_words = max(1, int(min_words))
        self.min_keyword_overlap = max(0, int(min_keyword_overlap))
        self.min_similarity = max(0.0, float(min_similarity))
        self.min_content_words = max(0, int(min_content_words))
        self._similarity_fn = similarity_fn or token_jaccard

    # ------------------------------------------------------------------ #
    # Primary entry point
    # ------------------------------------------------------------------ #

    def validate(self, question: str, answer: str) -> ValidationResult:
        """Run all checks and return a fully-populated :class:`ValidationResult`.

        Order of checks:

        1. Empty / whitespace
        2. Word count below ``min_words``
        3. Keyword overlap with the question below ``min_keyword_overlap``
        4. Similarity below ``min_similarity``

        The first failing check wins and populates ``reason`` +
        ``evaluation``. If the question itself has no content keywords
        (e.g. the interviewer typed only stopwords) the keyword check is
        skipped — similarity alone decides.
        """
        answer_clean = (answer or "").strip()
        word_count = len(answer_clean.split())

        if not answer_clean:
            return self._reject(
                REASON_EMPTY,
                word_count=0,
                question_keywords=(),
                answer_keywords=(),
                overlap=0,
                similarity=0.0,
            )

        if word_count < self.min_words:
            return self._reject(
                REASON_TOO_SHORT,
                word_count=word_count,
                question_keywords=tuple(
                    extract_keywords(question, extra_stopwords=QUESTION_FILLERS)
                ),
                answer_keywords=tuple(extract_keywords(answer_clean)),
                overlap=0,
                similarity=0.0,
            )

        q_keywords = extract_keywords(question, extra_stopwords=QUESTION_FILLERS)
        a_keywords = extract_keywords(answer_clean)
        overlap = count_keyword_overlap(q_keywords, a_keywords)
        similarity = float(self._similarity_fn(q_keywords, a_keywords))

        # Substantive answers get to the LLM regardless of vocabulary —
        # the grader can judge semantic correctness even when the answer
        # phrases things differently than the question.
        sparse_answer = len(a_keywords) < self.min_content_words

        # If the question has no content keywords at all, skip the overlap
        # check entirely — we can't blame the candidate for the prompt.
        if q_keywords and overlap < self.min_keyword_overlap and sparse_answer:
            return self._reject(
                REASON_NO_KEYWORD_OVERLAP,
                word_count=word_count,
                question_keywords=tuple(q_keywords),
                answer_keywords=tuple(a_keywords),
                overlap=overlap,
                similarity=similarity,
            )

        if q_keywords and similarity < self.min_similarity and sparse_answer:
            return self._reject(
                REASON_LOW_SIMILARITY,
                word_count=word_count,
                question_keywords=tuple(q_keywords),
                answer_keywords=tuple(a_keywords),
                overlap=overlap,
                similarity=similarity,
            )

        return ValidationResult(
            is_valid=True,
            reason=None,
            word_count=word_count,
            question_keywords=tuple(q_keywords),
            answer_keywords=tuple(a_keywords),
            overlap_count=overlap,
            similarity=similarity,
            evaluation=None,
        )

    # ------------------------------------------------------------------ #
    # Internals
    # ------------------------------------------------------------------ #

    def _reject(
        self,
        reason: str,
        *,
        word_count: int,
        question_keywords: Tuple[str, ...],
        answer_keywords: Tuple[str, ...],
        overlap: int,
        similarity: float,
    ) -> ValidationResult:
        logger.info(
            "Answer rejected by validator (%s) — words=%d, overlap=%d, similarity=%.3f",
            reason,
            word_count,
            overlap,
            similarity,
        )
        return ValidationResult(
            is_valid=False,
            reason=reason,
            word_count=word_count,
            question_keywords=question_keywords,
            answer_keywords=answer_keywords,
            overlap_count=overlap,
            similarity=similarity,
            evaluation=_build_irrelevant_evaluation(reason, word_count),
        )


# --------------------------------------------------------------------------- #
# Canonical "invalid answer" evaluation envelopes
# --------------------------------------------------------------------------- #


def _build_irrelevant_evaluation(reason: str, word_count: int) -> Dict[str, Any]:
    """Deterministic evaluation returned for every failed validation.

    Matches the exact shape :class:`AnswerEvaluator` emits so the guard
    clause can return it without post-processing. Scores are harsh on
    purpose — this is the whole point of the validation layer.
    """
    if reason == REASON_EMPTY:
        correctness, clarity, completeness = 0.0, 0.0, 0.0
        strengths = ["No relevant answer provided"]
        improvements = [
            "Answer the question directly and provide relevant details",
        ]
        detailed = "No answer was provided."
    elif reason == REASON_TOO_SHORT:
        correctness, clarity, completeness = 0.0, 15.0, 0.0
        strengths = ["No relevant answer provided"]
        improvements = [
            "Answer the question directly and provide relevant details",
            "Expand the answer — aim for at least a full sentence with context",
        ]
        detailed = (
            f"Answer is too short ({word_count} word(s)) to evaluate "
            "meaningfully."
        )
    elif reason == REASON_NO_KEYWORD_OVERLAP:
        correctness, clarity, completeness = 0.0, 20.0, 0.0
        strengths = ["No relevant answer provided"]
        improvements = [
            "Answer the question directly and provide relevant details",
            "Address the specific topic asked about in the question",
        ]
        detailed = (
            "Answer does not address the question — none of the question's "
            "key terms appear in the response."
        )
    elif reason == REASON_LOW_SIMILARITY:
        correctness, clarity, completeness = 0.0, 25.0, 0.0
        strengths = ["No relevant answer provided"]
        improvements = [
            "Answer the question directly and provide relevant details",
            "Stay on topic — rephrase the question's key ideas in your answer",
        ]
        detailed = (
            "Answer appears unrelated to the question. Re-read the prompt "
            "and address it specifically."
        )
    else:  # defensive
        correctness, clarity, completeness = 0.0, 10.0, 0.0
        strengths = ["No relevant answer provided"]
        improvements = ["Answer the question directly and provide relevant details"]
        detailed = "Answer could not be validated."

    return {
        "correctness_score": correctness,
        "clarity_score": clarity,
        "completeness_score": completeness,
        "strengths": strengths,
        "areas_to_improve": improvements,
        "detailed_feedback": detailed,
        "source": f"fallback:irrelevant:{reason}",
    }


def build_semantic_relevance_envelope(
    similarity: float,
    explanation: str = "",
) -> Dict[str, Any]:
    """Evaluation shape when the pre-grader LLM deems the answer off-topic.

    :class:`AnswerValidator` heuristics are skipped only after this is returned
    from :class:`src.evaluation.relevance_scorer.RelevanceScorer`.
    """
    expl = (explanation or "").strip()
    if expl:
        detailed = f"Relevance (semantic): {float(similarity):.2f}. {expl}"
    else:
        detailed = f"Relevance (semantic) below the required floor ({float(similarity):.2f})."
    return {
        "correctness_score": 0.0,
        "clarity_score": 20.0,
        "completeness_score": 0.0,
        "strengths": ["No relevant answer provided"],
        "areas_to_improve": [
            "Answer the question directly and provide relevant details",
        ],
        "detailed_feedback": detailed,
        "source": f"fallback:irrelevant:{REASON_SEMANTIC_RELEVANCE}",
    }
