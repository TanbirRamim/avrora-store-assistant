from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from avrora.api import main, signals

SCHEDULE = {"queue": "3.1", "example": False, "days": {"2026-11-03": [["14:00", "18:00"]], "2026-11-04": [["07:00", "10:00"]]}}


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(signals, "_weather", lambda now: [])
    monkeypatch.delenv("AVRORA_DEMO_KEY", raising=False)
    signals._SIMULATED.clear()
    return TestClient(main.app)


def test_schedule_in_kyiv_time():
    now = datetime(2026, 11, 3, 11, 0, tzinfo=UTC)  # 13:00 in Kyiv
    out = signals.scheduled_power(now, SCHEDULE)
    assert [s.title for s in out] == ["Power cut 14:00–18:00", "Power cut 07:00–10:00"]
    assert out[0].starts_at == "2026-11-03T12:00:00Z" and out[0].severity == "high"
    assert out[0].id == "power:3.1:2026-11-03T12:00:00Z" and not out[0].simulated
    active = signals.scheduled_power(datetime(2026, 11, 3, 13, 0, tzinfo=UTC), SCHEDULE)
    assert active[0].title == "Power cut until 18:00"


def test_only_notable_weather():
    daily = {"time": ["2026-11-03", "2026-11-04"], "temperature_2m_min": [2, -8], "temperature_2m_max": [9, -1],
             "wind_gusts_10m_max": [30, 40], "weather_code": [3, 71]}
    out = signals.notable_weather(daily, datetime(2026, 11, 3, 8, tzinfo=UTC))
    assert [s.title for s in out] == ["Frost down to −8 °C"]


def test_simulate_and_clear(client):
    assert client.post("/api/signals/simulate", json={"kind": "fire"}).status_code == 422
    sim = client.post("/api/signals/simulate", json={"kind": "air_alert", "minutes": 30}).json()
    assert sim["simulated"] and sim["kind"] == "air_alert" and sim["source"] == "Simulated for the demo"
    body = client.get("/api/signals").json()
    assert body["signals"][0]["id"] == sim["id"]
    assert {f["kind"] for f in body["feeds"]} == {"power", "air_alert", "weather"}
    assert client.delete("/api/signals/simulate").status_code == 204
    assert all(not s["id"].startswith("sim:") for s in client.get("/api/signals").json()["signals"])


def test_simulate_needs_demo_key_when_set(client, monkeypatch):
    monkeypatch.setenv("AVRORA_DEMO_KEY", "secret")
    assert client.post("/api/signals/simulate", json={"kind": "power"}).status_code == 403
    r = client.post("/api/signals/simulate", json={"kind": "power"}, headers={"X-Demo-Key": "secret"})
    assert r.status_code == 201 and r.json()["severity"] == "high"
