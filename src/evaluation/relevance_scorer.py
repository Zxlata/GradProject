"""
Ollama-based question–answer semantic relevance (0.0–1.0) before the grader.

Matches the product prompt: only ``similarity`` and ``on-topic`` judgment,
ignoring style/length. Used to skip the heavy evaluation LLM for irrelevant
replies. See ``config.RELEVANCE_*`` and ``PromptTemplates.relevance_qa_batch``.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from config import OLLAMA_MODEL, RELEVANCE_LLM_LOW_TEMP, RELEVANCE_LLM_MAX_PAIRS
from src.llm_integration.json_parser import JSONParser
from src.llm_integration.ollama_client import OllamaClient
from src.llm_integration.prompts import PromptTemplates
from src.utils.helpers import clamp
from src.utils.logger import get_logger

logger = get_logger(__name__)


def _clamp_similarity(value: Any) -> float:
    try:
        return clamp(float(value), 0.0, 1.0)
    except (TypeError, ValueError):
        return 0.0


def _parse_relevance_response(text: str) -> Optional[List[Dict[str, Any]]]:
    """
    Parse ``{ "results": [ { "id", "similarity", "explanation" } ] }``.

    Returns a list of dicts with str keys, or None on failure.
    """
    parsed = JSONParser.extract_json(text)
    if parsed is None:
        return None
    results = parsed.get("results")
    if not isinstance(results, list):
        logger.warning("Relevance JSON missing or invalid 'results' list")
        return None

    out: List[Dict[str, Any]] = []
    for item in results:
        if not isinstance(item, dict):
            continue
        try:
            qid = int(item.get("id", -1))
        except (TypeError, ValueError):
            continue
        if qid < 1:
            continue
        sim = _clamp_similarity(item.get("similarity", 0))
        expl = str(item.get("explanation") or "").strip()
        out.append(
            {
                "id": qid,
                "similarity": sim,
                "explanation": expl,
            }
        )

    return out or None


class RelevanceScorer:
    """Calls the small relevance prompt and returns per-id similarity scores."""

    def __init__(
        self,
        client: OllamaClient,
        model: str = OLLAMA_MODEL,
        max_pairs: int = RELEVANCE_LLM_MAX_PAIRS,
    ) -> None:
        self.client = client
        self.model = model
        self.max_pairs = max(1, int(max_pairs))

    def score_pairs(
        self,
        pairs: List[Tuple[int, str, str]],
    ) -> Optional[Dict[int, Dict[str, Any]]]:
        """Score each (id, question, answer). Returns id -> {similarity, explanation}.

        ``pairs`` are local ids 1..n (batch indexing). The prompt must use the
        same ids so the model's ``results`` matches.
        On transport/parse errors returns ``None`` (caller may fall back).
        """
        if not pairs:
            return {}

        # Chunk so prompts stay a bounded size
        by_id: Dict[int, Dict[str, Any]] = {}
        for start in range(0, len(pairs), self.max_pairs):
            chunk = pairs[start : start + self.max_pairs]
            one = self._score_chunk(chunk)
            if one is None:
                return None
            by_id.update(one)
        return by_id

    def _score_chunk(
        self,
        pairs: List[Tuple[int, str, str]],
    ) -> Optional[Dict[int, Dict[str, Any]]]:
        prompt = PromptTemplates.relevance_qa_batch(pairs)
        resp = self.client.generate(
            prompt,
            model=self.model,
            temperature=RELEVANCE_LLM_LOW_TEMP,
            top_p=0.9,
            top_k=40,
        )
        if "error" in resp:
            logger.warning("Relevance LLM error: %s", resp.get("error"))
            return None
        text = resp.get("response", "") or ""
        row_list = _parse_relevance_response(text)
        if row_list is None:
            logger.warning("Failed to parse relevance LLM output")
            return None

        by_id: Dict[int, Dict[str, Any]] = {}
        for row in row_list:
            by_id[int(row["id"])] = {
                "similarity": float(row["similarity"]),
                "explanation": str(row.get("explanation", "")),
            }
        # Require every input id to appear
        for qid, _, _ in pairs:
            if qid not in by_id:
                logger.warning("Relevance result missing id=%s", qid)
                return None
        return by_id
