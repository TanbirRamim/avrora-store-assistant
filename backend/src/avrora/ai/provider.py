"""The store's own AI model behind an OpenAI-compatible chat-completions API.

Configured by env vars (backend/.env, git-ignored): AI_BASE_URL (e.g. https://host/v1), AI_MODEL and
AI_API_KEY. The key is only sent to the provider; it is never returned or logged.
AI_MODEL may list fallbacks, comma separated: when a model is busy or gone (404, 429, 5xx, timeout) the
next one answers, each within ATTEMPT_S and all within TOTAL_S. AI_REASONING_EFFORT (optional, e.g. "low") keeps thinking models fast.
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx

log = logging.getLogger(__name__)

MAX_TOKENS = 1500
TOTAL_S = 25.0  # every model gets tried within this; the browser gives up at 30 s
ATTEMPT_S = 12.0  # at most per model, so one slow model can't use up the whole budget
MIN_ATTEMPT_S = 3.0  # not worth starting a model with less time than this left
RETRY_PAUSE_S = 1.0  # one more pass over the models when all were busy
MAX_RESPONSE = 1024 * 1024  # bytes read from any upstream answer
LOCAL_HOSTS = ("localhost", "127.0.0.1")


class ResponseTooLarge(httpx.HTTPError):
    """An upstream answer was bigger than we are willing to read."""


def fetch(method: str, url: str, max_bytes: int = MAX_RESPONSE, **kwargs) -> httpx.Response:
    """httpx request that stops reading after max_bytes; raises ResponseTooLarge (an httpx.HTTPError)."""
    with httpx.stream(method, url, **kwargs) as r:
        declared = r.headers.get("content-length", "")
        if declared.isdigit() and int(declared) > max_bytes:
            raise ResponseTooLarge("Upstream answer too large")
        buf = bytearray()
        for chunk in r.iter_bytes():
            buf += chunk
            if len(buf) > max_bytes:
                raise ResponseTooLarge("Upstream answer too large")
        headers = [(k, v) for k, v in r.headers.items() if k.lower() not in ("content-encoding", "content-length")]
        return httpx.Response(r.status_code, headers=headers, content=bytes(buf), request=r.request)


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
    url = urlparse(base)
    if url.scheme != "https" and not (url.scheme == "http" and url.hostname in LOCAL_HOSTS):
        log.warning("AI_BASE_URL ignored: it must use https (http only for localhost)")
        return None
    return AiConfig(base.rstrip("/"), models, os.getenv("AI_API_KEY", "").strip(),
                    os.getenv("AI_REASONING_EFFORT", "").strip())


def _try_next(status: int) -> bool:
    """Worth trying the next model: it is gone, rate-limited or overloaded."""
    return status in (404, 429) or status >= 500


def chat(cfg: AiConfig, messages: list[dict], schema: dict | None = None, max_tokens: int = MAX_TOKENS) -> str:
    """Sends one chat and returns the text the model wrote. Raises ProviderError on any failure."""
    return answer(cfg, messages, schema, max_tokens)[0]


def _is_json(text: str) -> bool:
    try:
        json.loads(text)
    except ValueError:
        return False
    return True


def answer(cfg: AiConfig, messages: list[dict], schema: dict | None = None,
           max_tokens: int = MAX_TOKENS, total_s: float = TOTAL_S) -> tuple[str, str]:
    """Like chat, trying the fallback models in order; returns (text, model that answered).
    A model that is gone, busy, slow, empty or cut off hands over to the next one, and the list is
    walked twice, all within total_s. Raises ProviderError when none of them gives a usable answer."""
    headers = {"Authorization": f"Bearer {cfg.api_key}"} if cfg.api_key else {}
    body = {"messages": messages, "temperature": 0, "stream": False, "max_tokens": min(max_tokens, MAX_TOKENS)}
    if cfg.reasoning_effort:
        body["reasoning_effort"] = cfg.reasoning_effort
    deadline = time.monotonic() + total_s

    def call(model: str, fmt: dict | None) -> httpx.Response:
        left = min(ATTEMPT_S, deadline - time.monotonic())
        if left < MIN_ATTEMPT_S:
            raise httpx.TimeoutException("No time left for another model")
        return fetch("POST", f"{cfg.base_url}/chat/completions", headers=headers, timeout=left,
                     json={**body, "model": model, **({"response_format": fmt} if fmt else {})})

    last = "Can't reach the AI provider"
    for attempt, model in enumerate(cfg.models * 2):
        if deadline - time.monotonic() < MIN_ATTEMPT_S:
            break
        if attempt == len(cfg.models):
            time.sleep(RETRY_PAUSE_S)
        try:
            r = call(model, {"type": "json_schema", "json_schema": {"name": "answer", "schema": schema}} if schema else None)
            if r.status_code == 400 and schema:  # some providers only know plain JSON mode
                r = call(model, {"type": "json_object"})
        except httpx.TimeoutException:
            last = "The AI provider took too long"
            continue
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
        if schema and not _is_json(content):
            last = "The AI answer was cut off"  # ran out of tokens mid-answer: the next model may finish
            continue
        return content, model
    raise ProviderError(last)
