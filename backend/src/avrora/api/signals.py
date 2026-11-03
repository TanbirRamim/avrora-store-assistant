"""Live conditions for local development: mirrors /api/signals in cloudflare/src/external.ts.

Power cuts come from the hand-maintained cloudflare/src/outages.json, weather from Open-Meteo, and
air-raid alerts only from the demo simulation (the live alerts.in.ua feed exists only in the Worker).
Simulated events are kept in memory. Set AVRORA_DEMO_KEY to require an X-Demo-Key header locally.
"""

from __future__ import annotations

import json
import os
import secrets
import time
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, Header, HTTPException, Response
from pydantic import BaseModel, Field

router = APIRouter()

KYIV = ZoneInfo("Europe/Kyiv")
STORE = {"lat": 49.2331, "lon": 28.4682}
OUTAGES = Path(__file__).resolve().parents[4] / "cloudflare" / "src" / "outages.json"
POWER_SOURCE = "power company schedule (Vinnytsiaoblenergo)"
SIM_SOURCE = "Simulated for the demo"
WEATHER_SOURCE = "Open-Meteo (CC BY 4.0)"
LOOKAHEAD = timedelta(hours=24)
CACHE_S = 300


class Signal(BaseModel):
    id: str
    kind: Literal["power", "air_alert", "weather"]
    severity: Literal["high", "medium", "low"]
    title: str
    detail: str
    starts_at: str
    ends_at: str | None
    source: str
    simulated: bool


class Feed(BaseModel):
    kind: str
    source: str
    live: bool


class SignalsOut(BaseModel):
    updated_at: str
    signals: list[Signal]
    feeds: list[Feed]


class SimulateIn(BaseModel):
    kind: Literal["power", "air_alert"]
    minutes: int | None = Field(default=None, ge=1, le=720)
    starts_in: int | None = Field(default=None, ge=0, le=720)


_SIMULATED: list[dict] = []
_cache: dict[str, tuple[float, object]] = {}


def _iso(d: datetime) -> str:
    return d.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _hm(d: datetime) -> str:
    return d.astimezone(KYIV).strftime("%H:%M")


def _schedule() -> dict:
    try:
        return json.loads(OUTAGES.read_text())
    except (OSError, ValueError):
        return {"queue": "", "example": True, "days": {}}


def power_signal(id_: str, start: datetime, end: datetime, now: datetime, queue: str, source: str, simulated: bool) -> Signal:
    active = start <= now
    return Signal(
        id=id_, kind="power",
        severity="high" if active or start - now <= timedelta(hours=2) else "medium",
        title=f"Power cut until {_hm(end)}" if active else f"Power cut {_hm(start)}–{_hm(end)}",
        detail=f"Scheduled power cut for outage queue {queue}. Tills, lights and card terminals need backup power.",
        starts_at=_iso(start), ends_at=_iso(end), source=source, simulated=simulated,
    )


def alert_signal(id_: str, since: datetime, until: datetime | None, source: str, simulated: bool) -> Signal:
    return Signal(
        id=id_, kind="air_alert", severity="high", title="Air-raid alert",
        detail=f"Vinnytsia oblast, since {_hm(since)}. Staff and shoppers go to shelter; the floor work waits.",
        starts_at=_iso(since), ends_at=_iso(until) if until else None, source=source, simulated=simulated,
    )


def scheduled_power(now: datetime, schedule: dict | None = None) -> list[Signal]:
    s = schedule if schedule is not None else _schedule()
    today = now.astimezone(KYIV).date()
    source = f"{POWER_SOURCE} (example times)" if s.get("example") else POWER_SOURCE
    out = []
    for day in (today - timedelta(days=1), today, today + timedelta(days=1)):
        for start_s, end_s in s.get("days", {}).get(day.isoformat(), []):
            start = _at(day, start_s)
            end = _at(day, end_s)
            if end <= start:
                end += timedelta(days=1)
            if end <= now or start - now > LOOKAHEAD:
                continue
            out.append(power_signal(f"power:{s['queue']}:{_iso(start)}", start, end, now, s["queue"], source, bool(s.get("example"))))
    return out


def _at(day: date, hhmm: str) -> datetime:
    h, m = (int(x) for x in hhmm.split(":"))
    return datetime(day.year, day.month, day.day, tzinfo=KYIV) + timedelta(hours=h, minutes=m)


def notable_weather(daily: dict, now: datetime) -> list[Signal]:
    today = now.astimezone(KYIV).date().isoformat()
    out = []
    for i, day_s in enumerate(daily["time"][:2]):
        day = date.fromisoformat(day_s)
        when = "Today" if day_s == today else day.strftime("%A")
        base = {"kind": "weather", "severity": "low", "source": WEATHER_SOURCE, "simulated": False,
                "starts_at": _iso(_at(day, "00:00")), "ends_at": _iso(_at(day + timedelta(days=1), "00:00"))}
        gust, code = daily["wind_gusts_10m_max"][i], daily["weather_code"][i]
        tmin, tmax = daily["temperature_2m_min"][i], daily["temperature_2m_max"][i]
        deg = lambda t: f"{'−' if round(t) < 0 else ''}{abs(round(t))} °C"
        if code >= 95 or gust >= 70:
            out.append(Signal(**base, id=f"weather:storm:{day_s}", title=f"Storm, gusts up to {round(gust)} km/h",
                              detail=f"{when}. Storms raise the risk of unplanned power cuts; bring in outdoor displays."))
        elif tmin <= -5:
            out.append(Signal(**base, id=f"weather:frost:{day_s}", title=f"Frost down to {deg(tmin)}",
                              detail=f"{when}. Clear ice at the entrance; deliveries may run late on icy roads."))
        elif tmax >= 30:
            out.append(Signal(**base, id=f"weather:heat:{day_s}", title=f"Heat up to {deg(tmax)}",
                              detail=f"{when}. Fridges and air conditioning work harder; keep goods out of direct sun."))
    return out


def _weather(now: datetime) -> list[Signal] | None:
    hit = _cache.get("weather")
    if hit and time.monotonic() - hit[0] < CACHE_S:
        daily = hit[1]
    else:
        try:
            r = httpx.get("https://api.open-meteo.com/v1/forecast", timeout=8, params={
                "latitude": STORE["lat"], "longitude": STORE["lon"], "timezone": "Europe/Kyiv", "forecast_days": 2,
                "daily": "temperature_2m_min,temperature_2m_max,wind_gusts_10m_max,weather_code"})
            r.raise_for_status()
            daily = r.json()["daily"]
        except (httpx.HTTPError, KeyError, ValueError):
            return None
        _cache["weather"] = (time.monotonic(), daily)
    return notable_weather(daily, now)


def _simulated_signal(row: dict, now: datetime, queue: str) -> Signal:
    if row["kind"] == "power":
        return power_signal(f"sim:{row['id']}", row["start"], row["end"], now, queue, SIM_SOURCE, True)
    return alert_signal(f"sim:{row['id']}", row["start"], row["end"], SIM_SOURCE, True)


RANK = {"high": 0, "medium": 1, "low": 2}


@router.get("/api/signals", response_model=SignalsOut)
def signals() -> SignalsOut:
    now = datetime.now(UTC)
    s = _schedule()
    _SIMULATED[:] = [r for r in _SIMULATED if r["end"] > now]
    out = [_simulated_signal(r, now, s["queue"]) for r in _SIMULATED if r["start"] - now <= LOOKAHEAD]
    out += scheduled_power(now, s)
    weather = _weather(now)
    out += weather or []
    out.sort(key=lambda x: (RANK[x.severity], x.starts_at))
    power_source = f"{POWER_SOURCE} (example times)" if s.get("example") else POWER_SOURCE
    return SignalsOut(updated_at=_iso(now), signals=out, feeds=[
        Feed(kind="power", source=power_source, live=not s.get("example")),
        Feed(kind="air_alert", source="not connected yet, simulated only", live=False),
        Feed(kind="weather", source=WEATHER_SOURCE, live=weather is not None),
    ])


def _check_key(key: str | None) -> None:
    want = os.environ.get("AVRORA_DEMO_KEY")
    if want and not secrets.compare_digest(key or "", want):
        raise HTTPException(403, "Needs a valid X-Demo-Key header")


DEFAULTS = {"power": (240, 90), "air_alert": (45, 0)}


@router.post("/api/signals/simulate", response_model=Signal, status_code=201)
def simulate(body: SimulateIn, x_demo_key: str | None = Header(default=None)) -> Signal:
    _check_key(x_demo_key)
    minutes, starts_in = DEFAULTS[body.kind]
    now = datetime.now(UTC)
    start = now.replace(second=0, microsecond=0) + timedelta(minutes=body.starts_in if body.starts_in is not None else starts_in)
    row = {"id": f"{body.kind}-{secrets.token_hex(4)}", "kind": body.kind, "start": start,
           "end": start + timedelta(minutes=body.minutes or minutes)}
    _SIMULATED.append(row)
    return _simulated_signal(row, now, _schedule()["queue"])


@router.delete("/api/signals/simulate", status_code=204)
def clear_simulated(x_demo_key: str | None = Header(default=None)) -> Response:
    _check_key(x_demo_key)
    _SIMULATED.clear()
    return Response(status_code=204)
