import itertools
import json
import math

import pytest
from fastapi.testclient import TestClient

from avrora.api import main
from avrora.config import RULES, SETTINGS
from avrora.data.generate import generate
from avrora.workforce import plan as wp
from avrora.workforce.people import employee_list, employee_profile

DAYS = wp.plan_dates()


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AVRORA_LLM", "none")
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "d.sqlite")
    return TestClient(main.app)


def test_generator_is_reproducible(tmp_path):
    generate(out_dir=tmp_path)
    for f in sorted(SETTINGS.data_dir.glob("*.csv")):
        assert (tmp_path / f.name).read_bytes() == f.read_bytes(), f.name


@pytest.mark.parametrize("day", DAYS, ids=str)
def test_base_plan_keeps_every_rule(day):
    p = wp.base_week()[day]
    assert wp.violations(p) == []
    doc = wp.base_plan(day)
    assert doc["kpis"]["rule_violations"] == 0 and doc["kpis"]["overtime_hours"] == 0
    for s in doc["shifts"]:
        span = int(s["end"][:2]) - int(s["start"][:2])
        assert span <= RULES.max_shift_hours
        assert (s["break_at"] is not None) == (span > RULES.break_after_hours)


def test_week_caps_across_days():
    week: dict[str, float] = {}
    for p in wp.base_week().values():
        for eid, (s, t) in p.shifts.items():
            week[eid] = week.get(eid, 0) + wp.paid_hours(t - s)
    sd = wp.staff()
    for eid, h in week.items():
        assert h <= sd.employee(eid).week_cap
    days = list(wp.base_week().values())
    for a, b in itertools.pairwise(days):  # 11 h rest between consecutive planned days
        for eid in set(a.shifts) & set(b.shifts):
            assert b.shifts[eid][0] + 24 - a.shifts[eid][1] >= RULES.min_rest_hours


@pytest.mark.parametrize("day", DAYS, ids=str)
def test_every_replan_keeps_every_rule(day):
    for ev in wp.all_events(day):
        assert wp.violations(wp.replan_day(day, ev)) == [], ev
        assert wp.replan(day, ev)["kpis"]["rule_violations"] == 0


def test_required_follows_forecast():
    for day in DAYS:
        doc = wp.base_plan(day)
        for h in doc["hours"]:
            load = sum(h["workload"].values())
            assert h["required"] >= RULES.min_on_site
            assert abs(h["required"] - max(2, math.ceil(load / RULES.utilisation))) <= 1
            assert h["transactions"] <= h["customers"]
    mon, sat = wp.base_plan(DAYS[0]), wp.base_plan(DAYS[5])
    assert sum(h["customers"] for h in sat["hours"]) > sum(h["customers"] for h in mon["hours"])
    assert all(h["workload"]["receiving"] > 0 for h in mon["hours"][:3])  # Monday DC delivery
    assert mon["hours"][1]["required"] > mon["hours"][6]["required"]
    # evening peak beats mid-afternoon on a normal weekday
    tue = wp.base_plan(DAYS[1])["hours"]
    assert tue[10]["customers"] > tue[6]["customers"]
    # scheduled power cut on Wednesday cuts traffic in its window
    wed = wp.base_plan(DAYS[2])
    assert any(c["kind"] == "power" for c in wed["conditions"])


def test_spike_and_alert_change_requirement():
    day = DAYS[1]
    base = wp.base_plan(day)["hours"]
    spike = wp.replan(day, wp.normalise_event(day, "traffic_spike", None, "17:00", None))["hours"]
    alert = wp.replan(day, wp.normalise_event(day, "air_alert", None, "12:00", None))
    assert spike[9]["customers"] > base[9]["customers"] and spike[9]["required"] >= base[9]["required"]
    assert alert["hours"][4]["customers"] == 0 and alert["hours"][4]["required"] == RULES.min_on_site
    assert all(t["task"] == "shelter" for s in alert["shifts"] for t in s["tasks"] if "12:00" <= t["from"] < "14:00")


def test_deterministic():
    day, ev = DAYS[0], wp.normalise_event(DAYS[0], "sick", "E03", None, None)
    first = json.dumps([wp.base_plan(day), wp.replan(day, ev)])
    for f in (wp.base_week, wp.base_plan, wp.replan, wp.replan_day):
        f.cache_clear()
    assert json.dumps([wp.base_plan(day), wp.replan(day, ev)]) == first


@pytest.mark.parametrize("eid", ["E01", "E03", "E04", "E10"])
def test_sick_replan_diff(eid):
    day = DAYS[0]
    base = wp.base_plan(day)
    doc = wp.replan(day, wp.normalise_event(day, "sick", eid, None, None))
    before = {s["employee_id"]: (s["start"], s["end"]) for s in base["shifts"]}
    after = {s["employee_id"]: (s["start"], s["end"]) for s in doc["shifts"]}
    assert eid not in after
    diff = {d["employee_id"]: d for d in doc["diff"]}
    if eid in before:
        assert diff[eid]["after"] == "off" and diff[eid]["before"] == "-".join(before[eid])
    for e in set(before) | set(after):
        changed = before.get(e) != after.get(e)
        if changed:
            assert e in diff
            assert diff[e]["after"] == ("-".join(after[e]) if e in after else "off")
    # continuity: no one else loses their shift
    assert set(before) - {eid} <= set(after)
    assert doc["version"] == f"sick-{eid}" and doc["status"] == "draft"


def test_event_validation():
    with pytest.raises(wp.EventError):
        wp.normalise_event(DAYS[0], "flood", None, None, None)
    with pytest.raises(wp.EventError):
        wp.normalise_event(DAYS[0], "sick", "E99", None, None)
    with pytest.raises(wp.EventError):
        wp.normalise_event(DAYS[0], "power", None, "14:30", None)
    with pytest.raises(wp.EventError):
        wp.normalise_event(DAYS[0], "power", None, "14:00", "15:00")
    ev = wp.normalise_event(DAYS[0], "power", None, "19:00", "21:00")
    assert (ev.start, ev.end, ev.key) == (19, 21, "power-19")


def test_plan_api_approve_reject_flow(client):
    p = client.get("/api/workforce/plan").json()
    assert p["date"] == SETTINGS.today.isoformat() and p["status"] == "draft" and p["version"] == "base"
    assert client.get("/api/workforce/plan?date=2026-12-01").status_code == 404
    assert client.get("/api/workforce/plan?date=nope").status_code == 422

    r = client.post("/api/workforce/replan", json={"date": "2026-11-03", "event": {"kind": "sick", "employee_id": "E01"}})
    assert r.status_code == 200
    rp = r.json()
    assert rp["status"] == "draft" and rp["version"] == "sick-E01" and "diff" in rp
    assert rp["changes"][-1]["by"] == "agent"
    assert client.post("/api/workforce/replan", json={"date": "2026-11-03",
                                                      "event": {"kind": "power", "from": "09:30"}}).status_code == 422

    assert client.post("/api/workforce/plan/approve", json={"date": "2026-11-03", "version": "bogus"}).status_code == 422
    ok = client.post("/api/workforce/plan/approve", json={"date": "2026-11-03", "version": "sick-E01"}).json()
    assert ok["status"] == "approved" and ok["at"]
    now = client.get("/api/workforce/plan?date=2026-11-03").json()
    assert now["status"] == "approved" and now["version"] == "sick-E01"
    assert "E01" not in {s["employee_id"] for s in now["shifts"]}
    assert [c["by"] for c in now["changes"]] == ["agent", "agent", "manager"]

    assert client.post("/api/workforce/plan/reject", json={"date": "2026-11-03", "version": "sick-E01"}).status_code == 422
    rej = client.post("/api/workforce/plan/reject",
                      json={"date": "2026-11-03", "version": "sick-E01", "reason": "Olena is back"}).json()
    assert rej["status"] == "rejected"
    back = client.get("/api/workforce/plan?date=2026-11-03").json()
    assert back["status"] == "draft" and back["version"] == "base"
    assert "Olena is back" in back["changes"][-1]["summary"]
    # other days are untouched
    assert client.get("/api/workforce/plan?date=2026-11-04").json()["changes"][-1]["by"] == "agent"


def test_employees(client):
    lst = client.get("/api/workforce/employees").json()["employees"]
    assert len(lst) == 14
    by = {e["employee_id"]: e for e in lst}
    assert max(lst, key=lambda e: e["score"])["employee_id"] == "E03"
    assert by["E05"]["status_today"] == "sick" and by["E12"]["status_today"] == "vacation"
    assert all(0 <= e["score"] <= 100 and e["hours_this_week"] <= e["contract_hours_week"] for e in lst)
    assert any("Scan errors rising" in w for w in employee_profile("E09")["watch"])
    assert any("Late" in w for w in employee_profile("E06")["watch"])
    prof = client.get("/api/workforce/employees/E03").json()
    assert len(prof["performance"]) == 12 and prof["strengths"] and len(prof["availability"]) == 7
    assert prof["recent_shifts"] and prof["hours_this_week"] == by["E03"]["hours_this_week"]
    assert client.get("/api/workforce/employees/E99").status_code == 404
    assert employee_list()["demo_data"] is True
