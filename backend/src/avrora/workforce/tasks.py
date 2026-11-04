"""Task allocation: who works which station in each hour, by skill and measured performance.

Each workload task maps to a concrete station with a priority and a target skill. People are
matched by `fit` = their target-skill metric relative to the best in the store (0-1), and the
reason cites that metric against the store average.
"""

from __future__ import annotations

from datetime import timedelta

import pandas as pd

from avrora.config import SETTINGS
from avrora.workforce.data import Employee, StaffData
from avrora.workforce.model import HOURS, TASKS, DayInputs, hh

# station: (task, priority, performance column it is matched on, unit text)
STATIONS = {
    "Lead checkout": ("checkout", "Critical", "items_scanned_per_hour", "items/h"),
    "Checkout 2 & returns": ("checkout", "High", "customer_rating", "customer rating"),
    "Receiving dock": ("receiving", "Critical", "heavy_lifting", "lifting score"),
    "Priority restock aisles": ("replenishment", "High", "shelves_replenished_per_hour", "units/h"),
    "Promo & facing": ("merchandising", "Standard", "facing_neatness", "facing score"),
    "Shift lead / float": ("customer_service", "Standard", "customer_rating", "customer rating"),
    "Inventory count": ("inventory", "Standard", "audit_accuracy", "% count accuracy"),
    "Shelter": ("shelter", "Critical", None, ""),
}
TASK_STATION = {"receiving": "Receiving dock", "replenishment": "Priority restock aisles",
                "merchandising": "Promo & facing", "customer_service": "Shift lead / float"}
STICKY = 0.3  # prefer keeping someone on the same task as last hour


def recent_perf(sd: StaffData) -> pd.DataFrame:
    p = sd.performance
    p = p[p["week_start"] >= (SETTINGS.today - timedelta(weeks=4)).isoformat()]
    return p.groupby("employee_id").mean(numeric_only=True)


def _station_fit(perf: pd.DataFrame, emp: Employee, station: str) -> float:
    task, _, col, _ = STATIONS[station]
    if col is None:
        return 1.0
    if task not in emp.skills:
        return -1.0
    if emp.employee_id not in perf.index:
        return 0.5
    v = float(perf.loc[emp.employee_id, col])
    fit = v / (float(perf[col].max()) or 1.0)
    if station == "Lead checkout":
        fit *= 1 - float(perf.loc[emp.employee_id, "scan_error_rate"]) / 10  # 2% errors cost 20%
    if station == "Receiving dock":  # lifting and speed count equally
        fit = (fit + float(perf.loc[emp.employee_id, "cases_received_per_hour"]) / (float(perf["cases_received_per_hour"].max()) or 1.0)) / 2
    return round(fit, 4)


def allocate(sd: StaffData, inputs: DayInputs, shifts: dict[str, tuple[int, int]]) -> dict[str, list[dict]]:
    """Per employee, a list of blocks {from, to, task, station, priority, match, reason}."""
    perf = recent_perf(sd)
    emps = {e.employee_id: e for e in sd.employees}
    hourly: dict[str, dict[int, str]] = {eid: {} for eid in shifts}
    prev: dict[str, str] = {}
    fit = {(e, st): _station_fit(perf, emps[e], st) for e in shifts for st in STATIONS}
    for h in HOURS:
        on = sorted(eid for eid, (s, t) in shifts.items() if s <= h < t)
        if inputs.alert and inputs.alert[0] <= h < inputs.alert[1]:
            for eid in on:
                hourly[eid][h] = "Shelter"
            continue
        left = dict(inputs.workload[h])
        free = list(on)
        tills = 0
        while free:
            open_tasks = [k for k in TASKS if left[k] > 0.05 and any(k in emps[e].skills for e in free)]
            if not open_tasks:
                break
            # Critical stations first (first till, receiving dock), then the biggest remaining workload
            first_till = tills == 0
            task = max(open_tasks, key=lambda k: (k == "receiving" or (k == "checkout" and first_till),
                                                  left[k], -TASKS.index(k)))
            if task == "checkout":
                station = "Lead checkout" if tills == 0 else "Checkout 2 & returns"
                tills += 1
            else:
                station = TASK_STATION[task]
            eid = max(free, key=lambda e: (fit[e, station] + (STICKY if prev.get(e) == station else 0), e))
            hourly[eid][h] = station
            left[task] -= 1.0
            free.remove(eid)
        for eid in free:  # nothing left they can do: inventory count, floor help, or their main skill
            skills = emps[eid].skills
            hourly[eid][h] = ("Inventory count" if "inventory" in skills else
                              "Shift lead / float" if "customer_service" in skills else
                              "Checkout 2 & returns" if skills[0] == "checkout" else TASK_STATION[skills[0]])
        for eid in on:
            prev[eid] = hourly[eid][h]
    return {eid: _blocks(inputs, emps[eid], perf, fit, hourly[eid]) for eid in shifts}


def _blocks(inputs: DayInputs, emp: Employee, perf: pd.DataFrame, fit: dict, by_hour: dict[int, str]) -> list[dict]:
    out: list[dict] = []
    for h in sorted(by_hour):
        st = by_hour[h]
        if out and out[-1]["station"] == st and out[-1]["_to"] == h:
            out[-1]["_to"] = h + 1
        else:
            out.append({"_from": h, "_to": h + 1, "station": st})
    res = []
    for b in out:
        st = b["station"]
        task, prio, _, _ = STATIONS[st]
        res.append({"from": hh(b["_from"]), "to": hh(b["_to"]), "task": task, "station": st, "priority": prio,
                    "match": max(0, round(100 * fit[emp.employee_id, st])),
                    "reason": _reason(inputs, emp, perf, st, b["_from"], b["_to"])})
    return res


def _vs_avg(perf: pd.DataFrame, emp: Employee, col: str, unit: str) -> str:
    if emp.employee_id not in perf.index:
        return ""
    v = float(perf.loc[emp.employee_id, col])
    avg = float(perf.loc[perf[col] > 0, col].mean())
    fmt = (lambda x: f"{x:.1f}") if col in ("customer_rating", "audit_accuracy") else (lambda x: f"{x:.0f}")
    sep = "" if unit.startswith("%") else " "
    return f"{fmt(v)}{sep}{unit}, store average {fmt(avg)}"


def _reason(inputs: DayInputs, emp: Employee, perf: pd.DataFrame, station: str, a: int, b: int) -> str:
    rng = range(a, b)
    task, _, col, unit = STATIONS[station]
    if task == "shelter":
        return "Air-raid alert: store closed, staff and customers in the shelter"
    if task == "checkout":
        head = f"{sum(inputs.transactions[h] for h in rng)} transactions forecast"
    elif task == "receiving":
        head = f"{inputs.delivery_cases} cases due in the delivery window"
    elif task == "replenishment":
        head = f"Refill shelves after about {round(sum(inputs.units[h] for h in rng))} units sold"
    elif task == "merchandising":
        head = "Promotion displays, markdown labels and move-to-front actions"
    elif task == "inventory":
        head = "Cycle count of slow movers while the floor is covered"
    else:
        head = f"Floor help, up to {max(inputs.customers[h] for h in rng)} customers an hour"
    metric = _vs_avg(perf, emp, col, unit)
    return f"{head}; {metric}" if metric else head
