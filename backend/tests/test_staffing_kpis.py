"""Staffing push signals and the workforce KPI feedback."""

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from avrora.api import main, signals
from avrora.workforce import kpis

D1, D2 = "2026-11-02", "2026-11-03"


def plan(day, gaps=(), lead=True):
    shifts = [{"employee_id": "E01", "name": "Olena K.", "role": "shift_lead" if lead else "senior_cashier"}]
    return {"date": day, "opening": {"open": "08:00", "close": "21:00"}, "shifts": shifts,
            "gaps": [{"from": f, "to": t, "missing": m, "reason": "Everyone is at their limit"} for f, t, m in gaps]}


def at(hhmm, day=D1):  # Kyiv is UTC+2 in November
    h, m = (int(x) for x in hhmm.split(":"))
    return datetime.fromisoformat(f"{day}T00:00:00+00:00").replace(hour=h - 2, minute=m, tzinfo=UTC)


def keys(out):
    return [s.key for s in out]


def test_unapproved_only_from_seven():
    plans = {D1: plan(D1), D2: plan(D2)}
    assert signals.staffing_signals(at("06:30"), plans, {}, {}) == []
    out = signals.staffing_signals(at("07:05"), plans, {}, {})
    assert keys(out) == [f"staffing:unapproved:{D1}"] and out[0].severity == "high"
    assert out[0].url == f"/?view=team&date={D1}"
    assert signals.staffing_signals(at("07:05"), plans, {D1: True}, {}) == []
    assert signals.staffing_signals(at("21:30"), plans, {}, {}) == []  # closed


def test_gaps_today_and_tomorrow():
    plans = {D1: plan(D1, [("09:00", "11:00", 1), ("17:00", "20:00", 2)]), D2: plan(D2, [("18:00", "19:00", 1)])}
    out = signals.staffing_signals(at("15:30"), plans, {D1: True}, {})
    by = {s.key: s for s in out}
    assert f"staffing:gap:{D1}:09:00-11:00:1" not in by  # already over
    today = by[f"staffing:gap:{D1}:17:00-20:00:2"]
    assert today.title == "Short 2 people 17:00-20:00" and today.severity == "high"
    tomorrow = by[f"staffing:gap:{D2}:18:00-19:00:1"]
    assert tomorrow.title == "Tomorrow: short 1 person 18:00-19:00" and tomorrow.severity == "medium"
    assert tomorrow.url == f"/?view=team&date={D2}"
    early = {s.key: s for s in signals.staffing_signals(at("08:30"), plans, {D1: True}, {})}
    assert early[f"staffing:gap:{D1}:09:00-11:00:1"].severity == "high"
    assert early[f"staffing:gap:{D1}:17:00-20:00:2"].severity == "medium"
    # stable keys: the same situation later in the day gives the same key
    assert f"staffing:gap:{D1}:17:00-20:00:2" in early


def test_sick_and_missing_lead():
    plans = {D1: plan(D1, [("17:00", "20:00", 1)], lead=False), D2: plan(D2)}
    sick = {D1: [("E05", "Oksana V.", False), ("E07", "Andriy P.", True)]}
    by = {s.key: s for s in signals.staffing_signals(at("10:00"), plans, {D1: True}, sick)}
    called = by[f"staffing:sick:{D1}:E07"]
    assert called.title == "Andriy P. called in sick" and called.severity == "high"
    assert "Still short 1 person 17:00-20:00." in called.body
    assert by[f"staffing:sick:{D1}:E05"].severity == "medium"
    assert by[f"staffing:no_lead:{D1}"].title == "No shift lead today"
    assert f"staffing:no_lead:{D2}" not in by


def test_demo_calendar_fallback():
    plans = {D1: plan(D1), D2: plan(D2)}
    out = signals.staffing_signals(at("07:30", "2026-12-01"), plans, {}, {})
    assert keys(out) == [f"staffing:unapproved:{D1}"]


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AVRORA_LLM", "none")
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "d.sqlite")
    return TestClient(main.app)


def test_staffing_route_follows_approval(client):
    body = client.get("/api/signals/staffing").json()
    assert all(s["key"].startswith("staffing:") and s["url"].startswith("/?view=team&date=") for s in body["signals"])
    day = body["date"]
    client.post("/api/workforce/plan/approve", json={"date": day, "version": "base"}).raise_for_status()
    after = client.get("/api/signals/staffing").json()["signals"]
    assert f"staffing:unapproved:{day}" not in [s["key"] for s in after]


def test_sick_replan_is_a_sick_call(client, monkeypatch):
    day = client.get("/api/signals/staffing").json()["date"]
    client.post("/api/workforce/replan", json={"date": day, "event": {"kind": "sick", "employee_id": "E02"}}).raise_for_status()
    _plans, _, sick = signals.staffing_inputs()
    assert ("E02", True) in [(e, r) for e, _, r in sick[day]]


def test_kpis(client):
    k = client.get("/api/workforce/kpis").json()
    assert k["demo_data"] and len(k["weeks"]) == 4
    weeks = [w["week_start"] for w in k["weeks"]]
    assert weeks == sorted(weeks) and k["this_week"]["week_start"] == k["today"]
    for w in [*k["weeks"], k["this_week"]]:
        assert 0 < w["coverage_pct"] <= 100 and w["labour_hours"] > 0
        assert w["sales_per_labour_hour_uah"] == round(w["sales_uah"] / w["labour_hours"])
    assert k["decisions"]["approved"] == k["decisions"]["replans"] == 0
    d = k["today"]
    client.post("/api/workforce/replan", json={"date": d, "event": {"kind": "power", "from": "12:00"}})
    client.post("/api/workforce/plan/reject", json={"date": d, "version": "power-12", "reason": "Too costly"})
    client.post("/api/workforce/plan/approve", json={"date": d, "version": "base"})
    dec = client.get("/api/workforce/kpis").json()["decisions"]
    assert (dec["approved"], dec["rejected"], dec["replans"], dec["approval_rate_pct"]) == (1, 1, 1, 50.0)
    assert sum(w["approved"] for w in dec["by_week"]) == 1


def test_decisions_window():
    now = datetime(2026, 11, 3, tzinfo=UTC)
    rows = [("approved", "2026-09-01T10:00:00+00:00"), ("approved", "2026-11-02T10:00:00+00:00"),
            ("drafted", "2026-10-28T10:00:00+00:00"), ("rejected", "2026-11-01T10:00:00Z")]
    d = kpis.decisions(rows, now)
    assert (d["approved"], d["rejected"], d["replans"]) == (1, 1, 1)
    assert [w["week_start"] for w in d["by_week"]] == ["2026-10-26", "2026-11-02"]
