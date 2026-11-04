"""Shared request guards: client key, sliding-window rate limit and capped body reading."""

from __future__ import annotations

import time
from collections import deque

from fastapi import HTTPException, Request

from avrora.config import SETTINGS

IDLE_SWEEP_AT = 1024  # sweep idle keys once the table grows past this


def client_key(request: Request) -> str:
    """The socket peer, or, only when AVRORA_CLIENT_IP_HEADER is set, the last value of that header
    (the one a trusted reverse proxy appended)."""
    header = SETTINGS.client_ip_header
    if header:
        value = request.headers.get(header, "").split(",")[-1].strip()
        if value:
            return value[:64]
    return request.client.host if request.client else "local"


class RateLimiter:
    def __init__(self, window_s: int, per_window: int) -> None:
        self.window_s, self.per_window = window_s, per_window
        self.hits: dict[str, deque[float]] = {}

    def limited(self, key: str) -> bool:
        now = time.monotonic()
        if len(self.hits) > IDLE_SWEEP_AT:
            for k in [k for k, q in self.hits.items() if not q or now - q[-1] > self.window_s]:
                del self.hits[k]
        q = self.hits.setdefault(key, deque())
        while q and now - q[0] > self.window_s:
            q.popleft()
        if len(q) >= self.per_window:
            return True
        q.append(now)
        return False


async def read_json_body(request: Request, max_bytes: int) -> bytes:
    """Body of a JSON request: 415 unless application/json, 413 as soon as it exceeds max_bytes."""
    if request.headers.get("content-type", "").split(";")[0].strip().lower() != "application/json":
        raise HTTPException(415, "Content-Type must be application/json")
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > max_bytes:
        raise HTTPException(413, "Request too large")
    buf = bytearray()
    async for chunk in request.stream():
        buf += chunk
        if len(buf) > max_bytes:
            raise HTTPException(413, "Request too large")
    return bytes(buf)
