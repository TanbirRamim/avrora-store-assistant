"""Employee list and profiles: a 0-100 score from weekly performance, strengths and watch points."""

from __future__ import annotations

from datetime import timedelta
from functools import lru_cache

import pandas as pd

from avrora.config import SETTINGS
from avrora.workforce.data import Employee, StaffData, staff
from avrora.workforce.model import hh
from avrora.workforce.plan import base_week, plan_dates
from avrora.workforce.scheduler import paid_hours

# main productivity measure per role
MAIN = {"shift_lead": "items_scanned_per_hour", "senior_cashier": "items_scanned_per_hour",
        "cashier": "items_scanned_per_hour", "stocker": "cases_received_per_hour",
        "merchandiser": "shelves_replenished_per_hour"}
UNIT = {"items_scanned_per_hour": "items/h at the till", "cases_received_per_hour": "cases/h received",
        "shelves_replenished_per_hour": "units/h replenished"}


# strength tag: the metric where someone is furthest above the store average
STRENGTH_TAGS = [("items_scanned_per_hour", "Fast checkout"), ("shelves_replenished_per_hour", "Fast restock"),
                 ("cases_received_per_hour", "Receiving lead"), ("audit_accuracy", "Accurate counter"),
                 ("facing_neatness", "Merchandising eye"), ("customer_rating", "Customer favourite")]
TAG_SKILL = {"items_scanned_per_hour": "checkout", "shelves_replenished_per_hour": "replenishment",
             "cases_received_per_hour": "receiving", "audit_accuracy": "inventory",
             "facing_neatness": "merchandising", "customer_rating": "customer_service"}


def strength_tag(sd: StaffData, emp: Employee) -> str:
    """Deterministic: the skill metric with the highest ratio to the store average (ties: list order)."""
    p = sd.performance[sd.performance["week_start"] >= (SETTINGS.today - timedelta(weeks=4)).isoformat()]
    mine = p[p["employee_id"] == emp.employee_id]
    best, best_ratio = "Customer favourite", -1.0
    for col, tag in STRENGTH_TAGS:
        if TAG_SKILL[col] not in emp.skills:
            continue
        avg = float(p.loc[p[col] > 0, col].mean())
        v = float(mine[col].mean())
        ratio = v / avg if avg else 0.0
        if v and ratio > best_ratio + 1e-9:
            best, best_ratio = tag, ratio
    return best


def _clamp(x: float) -> float:
    return max(0.0, min(100.0, x))


def _score(perf: pd.DataFrame, emp: Employee, rows: pd.DataFrame) -> int:
    """Weighted 0-100: productivity vs team median 30%, scan accuracy 20%, punctuality 20%,
    customer rating 15%, attendance 15%. rows = this employee's weeks to score."""
    col = MAIN[emp.role]
    team = perf.loc[perf[col] > 0, col].median()
    v = float(rows[col].mean())
    prod = _clamp(50 + 100 * (v / team - 1)) if team and v else 60.0
    err = float(rows["scan_error_rate"].mean())
    quality = _clamp(100 - 30 * err) if err else 80.0
    punct = _clamp((float(rows["punctuality_pct"].mean()) - 80) * 5)
    rating = _clamp((float(rows["customer_rating"].mean()) - 3) / 2 * 100)
    attend = _clamp(100 - 20 * float(rows["absences"].sum()))
    return round(0.3 * prod + 0.2 * quality + 0.2 * punct + 0.15 * rating + 0.15 * attend)


def _weeks(sd: StaffData, eid: str) -> pd.DataFrame:
    return sd.performance[sd.performance["employee_id"] == eid].sort_values("week_start")


def score_and_trend(sd: StaffData, emp: Employee) -> tuple[int, str]:
    w = _weeks(sd, emp.employee_id)
    now, before = _score(sd.performance, emp, w.tail(4)), _score(sd.performance, emp, w.iloc[-8:-4])
    trend = "up" if now - before >= 3 else "down" if before - now >= 3 else "flat"
    return now, trend


def strengths_and_watch(sd: StaffData, emp: Employee) -> tuple[list[str], list[str]]:
    w = _weeks(sd, emp.employee_id)
    last, first = w.tail(4), w.head(4)
    perf = sd.performance
    col = MAIN[emp.role]
    team = float(perf.loc[perf[col] > 0, col].median())
    v = float(last[col].mean())
    strengths, watch = [], []
    if v and v >= 1.12 * team:
        strengths.append(f"Fast: {v:.0f} {UNIT[col]} (team median {team:.0f})")
    if v and v <= 0.9 * team:
        watch.append(f"Slower than the team: {v:.0f} {UNIT[col]} (median {team:.0f})")
    err_now, err_then = float(last["scan_error_rate"].mean()), float(first["scan_error_rate"].mean())
    if 0 < err_now <= 0.35:
        strengths.append(f"Accurate at the till: {err_now:.1f}% scan errors")
    if err_now >= 1.2 and err_now > 1.5 * err_then:
        watch.append(f"Scan errors rising: {err_then:.1f}% to {err_now:.1f}% over 12 weeks; check training or till setup")
    p_now, p_then = float(last["punctuality_pct"].mean()), float(first["punctuality_pct"].mean())
    if p_now >= 98.5:
        strengths.append(f"Always on time ({p_now:.0f}% of shifts)")
    if p_now < 90:
        watch.append(f"Late for {100 - p_now:.0f}% of shifts (was {100 - p_then:.0f}%); avoid giving opening shifts")
    r = float(last["customer_rating"].mean())
    if r >= 4.75:
        strengths.append(f"Customers rate them {r:.1f} of 5")
    elif r < 4.2:
        watch.append(f"Customer rating {r:.1f} of 5, below the team")
    abs4 = int(last["absences"].sum())
    if abs4 >= 2:
        watch.append(f"{abs4} sick days in the last 4 weeks")
    new = emp.start_date >= (SETTINGS.today - timedelta(days=365)).isoformat()
    if new and float(last[col].mean()) > float(first[col].mean()):
        strengths.append("New starter, improving week by week")
    return strengths, watch


def _status_today(sd: StaffData, eid: str) -> str:
    a = sd.availability
    row = a[(a["date"] == SETTINGS.today.isoformat()) & (a["employee_id"] == eid)]
    return str(row.iloc[0]["status"]) if len(row) else "unavailable"


def _planned(eid: str) -> list[dict]:
    out = []
    for d, p in base_week().items():
        if eid in p.shifts:
            s, t = p.shifts[eid]
            out.append({"date": d.isoformat(), "start": hh(s), "end": hh(t), "hours": paid_hours(t - s)})
    return out


@lru_cache(maxsize=1)
def employee_list() -> dict:
    sd = staff()
    rows = []
    for e in sd.employees:
        score, trend = score_and_trend(sd, e)
        planned = _planned(e.employee_id)
        rows.append({"employee_id": e.employee_id, "name": e.name, "role": e.role, "skills": list(e.skills),
                     "contract_hours_week": e.contract_hours_week,
                     "hours_this_week": round(sum(x["hours"] for x in planned), 1),
                     "status_today": _status_today(sd, e.employee_id),
                     "next_shift": ({k: planned[0][k] for k in ("date", "start", "end")} if planned else None),
                     "score": score, "trend": trend, "strength": strength_tag(sd, e)})
    return {"demo_data": True, "week_start": plan_dates()[0].isoformat(), "employees": rows}


@lru_cache(maxsize=32)
def employee_profile(eid: str) -> dict | None:
    sd = staff()
    e = sd.employee(eid)
    if e is None:
        return None
    row = next(r for r in employee_list()["employees"] if r["employee_id"] == eid)
    strengths, watch = strengths_and_watch(sd, e)
    w = _weeks(sd, eid).tail(12)
    perf = [{k: (v.item() if hasattr(v, "item") else v) for k, v in r.items() if k != "employee_id"}
            for r in w.to_dict("records")]
    sh = sd.shifts[sd.shifts["employee_id"] == eid].sort_values("date", ascending=False).head(10)
    recent = [{"date": r.date, "start": r.start, "end": r.end, "tasks": r.tasks.split(";")} for r in sh.itertuples()]
    a = sd.availability
    days = [d.isoformat() for d in plan_dates()]
    av = a[(a["employee_id"] == eid) & a["date"].isin(days)].sort_values("date")
    availability = [{"date": r.date, "status": r.status, "from": r.available_from or None,
                     "to": r.available_to or None, "note": r.note} for r in av.itertuples()]
    return {**row, "hourly_cost_uah": e.hourly_cost_uah, "start_date": e.start_date, "can_open": e.can_open,
            "can_close": e.can_close, "demo_data": True, "performance": perf, "strengths": strengths,
            "watch": watch, "recent_shifts": recent, "availability": availability,
            "planned_shifts": _planned(eid)}
