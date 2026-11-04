"""The store's own AI model behind an OpenAI-compatible chat-completions API.

Configured by env vars (backend/.env, git-ignored): AI_BASE_URL (e.g. https://host/v1), AI_MODEL and
AI_API_KEY. The key is only sent to the provider; it is never returned or logged.
AI_MODEL may list fallbacks, comma separated: when a model is busy or gone (404, 429, 5xx, timeout) the
next one answers. AI_REASONING_EFFORT (optional, e.g. "low") keeps thinking models fast.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass

import httpx

MAX_TOKENS = 1500
TIMEOUT_S = 45  # per model; the next fallback gets its own
RETRY_PAUSE_S = 1.5  # one more pass over the models when all were busy


class ProviderError(Exception):
    """The provider could not be reached or sent no usable answer."""


@dataclass(frozen=True)
class AiConfig:
    base_url: str
    models: tuple[str, ...]
    api_key: str
    reasoning_effort: str = ""

    @property
    def model(self) -> str:
        return self.models[0]


def config() -> AiConfig | None:
    base = os.getenv("AI_BASE_URL", "").strip()
    models = tuple(m.strip() for m in os.getenv("AI_MODEL", "").split(",") if m.strip())
    if not base or not models:
        return None
    return AiConfig(base.rstrip("/"), models, os.getenv("AI_API_KEY", "").strip(),
                    os.getenv("AI_REASONING_EFFORT", "").strip())


def _try_next(status: int) -> bool:
    """Worth trying the next model: it is gone, rate-limited or overloaded."""
    return status in (404, 429) or status >= 500


def chat(cfg: AiConfig, messages: list[dict], schema: dict | None = None, max_tokens: int = MAX_TOKENS) -> str:
    """Sends one chat and returns the text the model wrote. Raises ProviderError on any failure."""
    return answer(cfg, messages, schema, max_tokens)[0]


def answer(cfg: AiConfig, messages: list[dict], schema: dict | None = None,
           max_tokens: int = MAX_TOKENS) -> tuple[str, str]:
    """Like chat, trying the fallback models in order; returns (text, model that answered).
    Raises ProviderError when none of them gives a usable answer."""
    headers = {"Authorization": f"Bearer {cfg.api_key}"} if cfg.api_key else {}
    body = {"messages": messages, "temperature": 0, "stream": False, "max_tokens": min(max_tokens, MAX_TOKENS)}
    if cfg.reasoning_effort:
        body["reasoning_effort"] = cfg.reasoning_effort

    def call(model: str, fmt: dict | None) -> httpx.Response:
        return httpx.post(f"{cfg.base_url}/chat/completions", headers=headers, timeout=TIMEOUT_S,
                          json={**body, "model": model, **({"response_format": fmt} if fmt else {})})

    last = "Can't reach the AI provider"
    for attempt, model in enumerate(cfg.models * 2):
        if attempt == len(cfg.models):
            time.sleep(RETRY_PAUSE_S)
        try:
            r = call(model, {"type": "json_schema", "json_schema": {"name": "answer", "schema": schema}} if schema else None)
            if r.status_code == 400 and schema:  # some providers only know plain JSON mode
                r = call(model, {"type": "json_object"})
        except httpx.HTTPError:
            last = "Can't reach the AI provider"
            continue
        if not r.is_success:
            last = f"The AI provider answered {r.status_code}"
            if _try_next(r.status_code):
                continue
            raise ProviderError(last)
        try:
            content = r.json()["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError):
            content = None
        if not isinstance(content, str) or not content.strip():
            last = "The AI provider sent no answer"
            continue
        return content, model
    raise ProviderError(last)
