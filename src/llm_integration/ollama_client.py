"""
HTTP client for a locally running Ollama server.

The public surface is small by design:

- ``is_server_running()``    health check
- ``list_models()``          enumerate pulled models
- ``generate(...)``          raw text generation
- ``generate_json(...)``     generate + extract a JSON object in one call
- ``chat(...)``              chat-format generation (multi-turn messages)

All errors are caught and returned as ``{"error": "..."}`` so callers never
have to wrap individual calls in try/except.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import requests

from config import OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_TIMEOUT_SECONDS
from src.llm_integration.json_parser import JSONParser
from src.utils.logger import get_logger

logger = get_logger(__name__)


class OllamaClient:
    """Thin wrapper around the Ollama REST API."""

    def __init__(
        self,
        base_url: str = OLLAMA_BASE_URL,
        timeout: int = OLLAMA_TIMEOUT_SECONDS,
        default_model: str = OLLAMA_MODEL,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.default_model = default_model

    # ------------------------------------------------------------------ #
    # Health / metadata
    # ------------------------------------------------------------------ #

    def is_server_running(self) -> bool:
        """True iff `/api/tags` responds with HTTP 200."""
        try:
            resp = requests.get(f"{self.base_url}/api/tags", timeout=5)
            return resp.status_code == 200
        except requests.RequestException:
            return False

    def list_models(self) -> List[str]:
        """Return names of models pulled on the server (empty list on failure)."""
        try:
            resp = requests.get(f"{self.base_url}/api/tags", timeout=10)
            resp.raise_for_status()
            models = resp.json().get("models", [])
            return [m["name"] for m in models if "name" in m]
        except requests.RequestException as e:
            logger.error("Failed to list models: %s", e)
            return []

    # ------------------------------------------------------------------ #
    # Generation
    # ------------------------------------------------------------------ #

    def generate(
        self,
        prompt: str,
        model: Optional[str] = None,
        temperature: float = 0.7,
        top_p: float = 0.9,
        top_k: int = 40,
        **extra_options: Any,
    ) -> Dict[str, Any]:
        """Send a `/api/generate` request and return the parsed JSON response.

        On failure returns ``{"error": "..."}`` instead of raising.
        """
        model = model or self.default_model
        payload: Dict[str, Any] = {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": temperature,
                "top_p": top_p,
                "top_k": top_k,
                **extra_options,
            },
        }

        try:
            logger.info("Ollama generate (model=%s, prompt_len=%d)", model, len(prompt))
            resp = requests.post(
                f"{self.base_url}/api/generate",
                json=payload,
                timeout=self.timeout,
            )
        except requests.Timeout:
            logger.error("Ollama request timed out after %ss", self.timeout)
            return {"error": "timeout"}
        except requests.RequestException as e:
            logger.error("Ollama request failed: %s", e)
            return {"error": str(e)}

        if resp.status_code != 200:
            logger.error("Ollama HTTP %s: %s", resp.status_code, resp.text[:200])
            return {"error": f"HTTP {resp.status_code}"}

        try:
            return resp.json()
        except ValueError as e:
            logger.error("Ollama returned invalid JSON: %s", e)
            return {"error": "invalid JSON from Ollama"}

    def generate_json(
        self,
        prompt: str,
        model: Optional[str] = None,
        **kwargs: Any,
    ) -> Optional[Dict[str, Any]]:
        """Convenience wrapper: generate and extract a JSON object.

        Returns ``None`` if the model errors out or no JSON object is recoverable.
        """
        resp = self.generate(prompt, model=model, **kwargs)
        if "error" in resp:
            return None
        return JSONParser.extract_json(resp.get("response", ""))

    def chat(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.7,
    ) -> Dict[str, Any]:
        """Chat-format call (`/api/chat`). ``messages`` = [{role, content}, ...]."""
        model = model or self.default_model
        payload = {
            "model": model,
            "messages": messages,
            "stream": False,
            "options": {"temperature": temperature},
        }

        try:
            resp = requests.post(
                f"{self.base_url}/api/chat",
                json=payload,
                timeout=self.timeout,
            )
        except requests.Timeout:
            return {"error": "timeout"}
        except requests.RequestException as e:
            return {"error": str(e)}

        if resp.status_code != 200:
            return {"error": f"HTTP {resp.status_code}"}

        try:
            return resp.json()
        except ValueError:
            return {"error": "invalid JSON from Ollama"}
