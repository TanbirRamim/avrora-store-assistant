"""Store AI proxy, same contract as cloudflare/src/ai.ts.

GET /api/ai/status -> {configured, model}; POST /api/ai/chat -> {content, model}.
503 when AI_BASE_URL/AI_MODEL are unset; the browser then uses its fixed rules.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, ValidationError
from starlette.concurrency import run_in_threadpool

from avrora.ai import provider

router = APIRouter(prefix="/api/ai")

MAX_BODY = 64 * 1024
WINDOW_S = 60
PER_WINDOW = 20
_hits: dict[str, deque[float]] = defaultdict(deque)


class Message(BaseModel):
    role: Literal["system", "user"]
    content: str


class ChatIn(BaseModel):
    messages: list[Message] = Field(min_length=1, max_length=4)
    schema_: dict | None = Field(default=None, alias="schema")
    max_tokens: int = Field(default=provider.MAX_TOKENS, ge=1)


class ChatOut(BaseModel):
    content: str
    model: str


class Status(BaseModel):
    configured: bool
    model: str | None


@router.get("/status", response_model=Status)
def status() -> Status:
    cfg = provider.config()
    return Status(configured=cfg is not None, model=cfg.model if cfg else None)


def _limited(ip: str) -> bool:
    now, q = time.monotonic(), _hits[ip]
    while q and now - q[0] > WINDOW_S:
        q.popleft()
    if len(q) >= PER_WINDOW:
        return True
    q.append(now)
    return False


@router.post("/chat", response_model=ChatOut)
async def chat(request: Request) -> ChatOut:
    cfg = provider.config()
    if cfg is None:
        raise HTTPException(503, "AI is not set up")
    if _limited(request.client.host if request.client else "local"):
        raise HTTPException(429, "Too many AI requests. Wait a minute.")
    raw = await request.body()
    if len(raw) > MAX_BODY:
        raise HTTPException(413, "Request too large")
    try:
        body = ChatIn.model_validate_json(raw)
    except ValidationError as e:
        raise HTTPException(422, "Body must be {messages: [{role, content}], schema?, max_tokens?}") from e
    try:
        # sync httpx call off the event loop
        content, model = await run_in_threadpool(
            provider.answer, cfg, [m.model_dump() for m in body.messages], body.schema_, body.max_tokens
        )
    except provider.ProviderError as e:
        raise HTTPException(502, str(e)) from e
    return ChatOut(content=content, model=model)
