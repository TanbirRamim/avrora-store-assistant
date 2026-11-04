"""Aerial-threat feed for the map's war-time layer. Mirrors cloudflare/src/wartime.ts (wartimeThreats).

Source: mapa.ua's public feed. Positions are unofficial estimates derived from public monitoring
channels; only objects marked "active" are passed on. Nothing is simulated: when the feed fails the
answer says so.
"""

from __future__ import annotations

from datetime import UTC, datetime

import httpx
from fastapi import APIRouter

from avrora.ai.provider import fetch

router = APIRouter()

THREATS_URL = "https://mapa.ua/api/v1/current"
MAX_THREATS = 2000


def summarise_threats(objects: list[dict], ts: float | None) -> dict:
    threats = [
        {
            "id": str(o["id"]),
            "kind": o.get("kind") if isinstance(o.get("kind"), str) else "unknown",
            "lat": o["lat"],
            "lon": o["lon"],
            "amount": o["amount"] if isinstance(o.get("amount"), int) and o["amount"] > 0 else 1,
            "seen_at": o.get("last_seen") if isinstance(o.get("last_seen"), str) else None,
        }
        for o in objects[:MAX_THREATS]
        if isinstance(o, dict)
        and o.get("status") == "active"
        and isinstance(o.get("lat"), (int, float))
        and isinstance(o.get("lon"), (int, float))
        and o.get("id") is not None
    ]
    fetched = datetime.now(UTC)
    if isinstance(ts, (int, float)) and not isinstance(ts, bool):
        try:
            fetched = datetime.fromtimestamp(ts, UTC)
        except (OverflowError, OSError, ValueError):
            pass
    return {"connected": True, "source": "mapa.ua", "fetched_at": fetched.isoformat(), "threats": threats}


@router.get("/api/wartime/threats")
def wartime_threats() -> dict:
    try:
        r = fetch("GET", THREATS_URL, headers={"User-Agent": "avrora-store-assistant"}, timeout=8)
        r.raise_for_status()
        body = r.json()
        if not isinstance(body, dict):
            raise TypeError("not an object")
        objects = body.get("objects")
    except (httpx.HTTPError, ValueError, TypeError):
        return {"connected": False, "reason": "unavailable"}
    return summarise_threats(objects if isinstance(objects, list) else [], body.get("ts"))
