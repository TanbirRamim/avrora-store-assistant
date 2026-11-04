"""Staffing plans for the next 7 days, replans for continuity events, KPIs and explanations.

Everything here is deterministic: the same data and event give the same plan, byte for byte.
Status and the audit trail (approvals) are added by the API from the database.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from functools import lru_cache

from avrora.config import RULES, SETTINGS
from avrora.workforce.data import StaffData, staff
from avrora.workforce.model import (
    EVENT_HOURS,
    EVENT_KINDS,
    HOURS,
    DayInputs,
    Event,
    day_inputs,
    hh,
    parse_hh,
    team_rates,
)
from avrora.workforce.scheduler import Person, assign_breaks, check_rules, paid_hours, schedule_day
from avrora.workforce.tasks import allocate

DAYS_AHEAD = 7
DEFAULT_EVENT_START = 12


def plan_dates() -> list[date]:
    return [SETTINGS.today + timedelta(days=i) for i in range(DAYS_AHEAD)]


def _span(s: str, t: str) -> tuple[int, int]:
    return parse_hh(s), parse_hh(t)


@dataclass
class DayPlan:
    day: date
    inputs: DayInputs
    shifts: dict[str, tuple[int, int]]
    people: dict[str, Person]
    week_other: dict[str, float]
    prev_end: dict[str, int]
    next_start: dict[str, int]


def _availability(sd: StaffData, day: date) -> dict[str, tuple[int, int] | None]:
    a = sd.availability[sd.availability["date"] == day.isoformat()]
    return {r.employee_id: _span(r.available_from, r.available_to) if r.status == "available" else None
            for r in a.itertuples()}


def _history_shifts(sd: StaffData, day: date) -> dict[str, tuple[int, int]]:
    s = sd.shifts[sd.shifts["date"] == day.isoformat()]
    return {r.employee_id: _span(r.start, r.end) for r in s.itertuples()}


def _week(day: date) -> list[date]:
    mon = day - timedelta(days=day.weekday())
    return [mon + timedelta(days=i) for i in range(7)]


def _shifts_on(sd: StaffData, base: dict[date, DayPlan], day: date) -> dict[str, tuple[int, int]]:
    if day in base:
        return base[day].shifts
    return _history_shifts(sd, day) if day < SETTINGS.today else {}


def _week_other(sd: StaffData, base: dict[date, DayPlan], day: date) -> dict[str, float]:
    out: dict[str, float] = {}
    for d in _week(day):
        if d == day:
            continue
        for eid, (s, t) in _shifts_on(sd, base, d).items():
            out[eid] = out.get(eid, 0.0) + paid_hours(t - s)
    return out


def _people(sd: StaffData, day: date, week_other: dict[str, float], prev_end: dict[str, int],
            next_start: dict[str, int], absent: str | None = None) -> dict[str, Person]:
    avail = _availability(sd, day)
    out = {}
    for e in sd.employees:
        window = None if e.employee_id == absent else avail.get(e.employee_id)
        p = Person(emp=e, window=window, cap_left=e.week_cap - week_other.get(e.employee_id, 0.0))
        if e.employee_id in prev_end:
            p.earliest = prev_end[e.employee_id] + RULES.min_rest_hours - 24
        if e.employee_id in next_start:
            p.latest = next_start[e.employee_id] - RULES.min_rest_hours + 24
        out[e.employee_id] = p
    return out


def _fair_share(sd: StaffData, day: date, people: dict[str, Person]) -> None:
    """Base plans only: spread each person's weekly hours over their remaining available days,
    so Sunday is not left without anyone. Replans may use the full weekly cap."""
    rest = [d for d in _week(day) if d >= day]
    av = sd.availability
    av = av[av["date"].isin([d.isoformat() for d in rest]) & (av["status"] == "available")]
    days_left = av.groupby("employee_id").size().to_dict()
    for eid, p in people.items():
        n = days_left.get(eid, 0)
        if n:
            p.cap_left = min(p.cap_left, max(float(RULES.min_shift_hours), p.cap_left / n + 1.0))


@lru_cache(maxsize=1)
def base_week() -> dict[date, DayPlan]:
    """The agent's draft plans for today..+6, planned day by day so weekly caps and rest carry over."""
    sd = staff()
    base: dict[date, DayPlan] = {}
    for day in plan_dates():
        week_other = _week_other(sd, base, day)
        prev_end = {e: t for e, (_, t) in _shifts_on(sd, base, day - timedelta(days=1)).items()}
        people = _people(sd, day, week_other, prev_end, {})
        _fair_share(sd, day, people)
        inputs = day_inputs(sd, day)
        sched = schedule_day(people, inputs.required)
        base[day] = DayPlan(day, inputs, sched.shifts, people, week_other, prev_end, {})
    for day, p in base.items():  # rest before tomorrow, for checks and replans
        p.next_start = {e: s for e, (s, _) in _shifts_on(sd, base, day + timedelta(days=1)).items()}
    return base


class EventError(ValueError):
    pass


def normalise_event(day: date, kind: str, employee_id: str | None, start: str | None, end: str | None) -> Event:
    """Validate a replan request. Windows are presets: whole-hour start, fixed length per kind."""
    if kind not in EVENT_KINDS:
        raise EventError(f"kind must be one of {', '.join(EVENT_KINDS)}")
    if kind == "sick":
        if not employee_id or staff().employee(employee_id) is None:
            raise EventError("sick needs a known employee_id")
        return Event("sick", employee_id=employee_id)
    try:
        a = DEFAULT_EVENT_START if start is None else parse_hh(start)
        if start is not None and not start.endswith(":00"):
            raise ValueError
    except ValueError:
        raise EventError("from must be a whole hour like 14:00") from None
    if not RULES.open_hour <= a < RULES.close_hour:
        raise EventError("from must be between 08:00 and 20:00")
    b = min(RULES.close_hour, a + EVENT_HOURS[kind])
    if end is not None and end != hh(b):
        raise EventError(f"{kind} lasts {EVENT_HOURS[kind]} h in the planner, so to must be {hh(b)} (or left out)")
    return Event(kind, start=a, end=b)


@lru_cache(maxsize=1024)
def replan_day(day: date, event: Event) -> DayPlan:
    sd = staff()
    base = base_week()
    b = base[day]
    absent = event.employee_id if event.kind == "sick" else None
    # base plans only knew the days before; a replan must also respect the later days of the week
    week_other = _week_other(sd, base, day)
    people = _people(sd, day, week_other, b.prev_end, b.next_start, absent=absent)
    seed = {e: s for e, s in b.shifts.items() if e != absent}
    inputs = day_inputs(sd, day, event)
    sched = schedule_day(people, inputs.required, seed=seed)
    return DayPlan(day, inputs, sched.shifts, people, week_other, b.prev_end, b.next_start)


def violations(p: DayPlan) -> list[str]:
    return check_rules(p.shifts, p.people, p.week_other, p.prev_end, p.next_start)


# --------------------------------------------------------------------------- the API document


def generated_at(day: date) -> str:
    return f"{day.isoformat()}T06:00:00+02:00"


def _absences(sd: StaffData, day: date) -> list[tuple[str, str]]:
    a = sd.availability[(sd.availability["date"] == day.isoformat()) & sd.availability["status"].isin(["sick", "vacation"])]
    return [(sd.employee(r.employee_id).name, r.status) for r in a.itertuples()]


def _gaps(p: DayPlan, scheduled: dict[int, int], absences: list[tuple[str, str]]) -> list[dict]:
    out = []
    cur = None
    for h in HOURS:
        miss = p.inputs.required[h] - scheduled[h]
        if miss > 0:
            if cur and cur["_to"] == h:
                cur["_to"], cur["missing"] = h + 1, max(cur["missing"], miss)
            else:
                cur = {"_from": h, "_to": h + 1, "missing": miss}
                out.append(cur)
    who = ", ".join(f"{n} {s}" for n, s in absences)
    reason = "Everyone available is already scheduled or at their weekly or 8-hour limit"
    if who:
        reason += f" ({who})"
    return [{"from": hh(g["_from"]), "to": hh(g["_to"]), "missing": g["missing"], "reason": reason} for g in out]


def _blocks(required: dict[int, int], scheduled: dict[int, int]) -> list[dict]:
    out: list[dict] = []
    for h in HOURS:
        r, s = required[h], scheduled[h]
        if out and out[-1]["required"] == r and out[-1]["scheduled"] == s:
            out[-1]["to"] = hh(h + 1)
        else:
            out.append({"from": hh(h), "to": hh(h + 1), "required": r, "scheduled": s})
    return out


def _explain(sd: StaffData, p: DayPlan, scheduled: dict[int, int], gaps: list[dict], event: Event | None,
             absences: list[tuple[str, str]]) -> list[str]:
    i = p.inputs
    out = []
    if event:
        out.append(_event_sentence(sd, event))
    peak = max(HOURS, key=lambda h: (i.required[h], i.customers[h], -h))
    extra = " plus the delivery" if i.workload[peak]["receiving"] > 0 else ""
    out.append(f"The most people are needed at {hh(peak)}: {i.required[peak]} for about {i.customers[peak]} "
               f"customers{extra}; the plan has {scheduled[peak]}.")
    if i.delivery_cases:
        recv = sorted({sd.employee(e).name for e, blocks in _alloc(sd, p).items()
                       for b in blocks if b["task"] == "receiving"})
        names = " and ".join(recv) if recv else "the opening team"
        out.append(f"{i.delivery_cases} cases arrive between 08:00 and 11:00, so {names} start on receiving.")
    if absences:
        out.append("Not available: " + ", ".join(f"{n} ({s})" for n, s in absences) + ".")
    if gaps:
        g = gaps[0]
        out.append(f"Short by {g['missing']} from {g['from']} to {g['to']}: no one else is available within the "
                   f"weekly cap and 11-hour rest rule. Consider a volunteer or moving a break.")
    else:
        out.append("Every open hour has enough people, a shift lead or senior cashier, an opener and a closer.")
    for c in i.conditions:
        if c["kind"] in ("power", "promotion") and not event:
            out.append(f"{c['label']} ({c['from']}-{c['to']}) is already in the forecast.")
            break
    return out[:5]


def _event_sentence(sd: StaffData, e: Event) -> str:
    if e.kind == "sick":
        return f"{sd.employee(e.employee_id).name} called in sick, so their hours are covered by others where the rules allow."
    if e.kind == "air_alert":
        return (f"Air-raid alert {hh(e.start)}-{hh(e.end)}: the store closes and staff take customers to the shelter; "
                f"expect a rush when it ends.")
    if e.kind == "power":
        return f"Power cut {hh(e.start)}-{hh(e.end)}: fewer customers and slower tills on the generator."
    return f"Traffic spike {hh(e.start)}-{hh(e.end)}: about 50% more customers than forecast."


def event_label(e: Event) -> str:
    if e.kind == "sick":
        return f"{staff().employee(e.employee_id).name} sick"
    what = {"air_alert": "air-raid alert", "power": "power cut", "traffic_spike": "traffic spike"}[e.kind]
    return f"{what} {hh(e.start)}-{hh(e.end)}"


def _alloc(sd: StaffData, p: DayPlan) -> dict[str, list[dict]]:
    return allocate(sd, p.inputs, p.shifts)


def plan_document(p: DayPlan, version: str = "base", event: Event | None = None) -> dict:
    sd = staff()
    i = p.inputs
    scheduled = {h: sum(s <= h < t for s, t in p.shifts.values()) for h in HOURS}
    absences = _absences(sd, p.day)
    if event and event.kind == "sick":
        name = sd.employee(event.employee_id).name
        absences = [a for a in absences if a[0] != name] + [(name, "sick")]
    gaps = _gaps(p, scheduled, absences)
    tasks = _alloc(sd, p)
    shifts = []
    breaks = assign_breaks(p.shifts)
    for eid, (s, t) in sorted(p.shifts.items(), key=lambda x: (x[1][0], x[1][1], x[0])):
        e = sd.employee(eid)
        shifts.append({"employee_id": eid, "name": e.name, "role": e.role, "start": hh(s), "end": hh(t),
                       "break_at": hh(breaks[eid]) if eid in breaks else None,
                       "hours": paid_hours(t - s), "tasks": tasks[eid]})
    labour = sum(x["hours"] for x in shifts)
    cost = sum(x["hours"] * sd.employee(x["employee_id"]).hourly_cost_uah for x in shifts)
    req_total = sum(i.required.values())
    covered = sum(min(i.required[h], scheduled[h]) for h in HOURS)
    revenue = sum(i.units.values()) * team_rates(sd).price_per_unit
    # this day's share of the week's overtime, so that summing the day documents gives the week's overtime
    before: dict[str, float] = {}
    for d in _week(p.day):
        if d < p.day:
            for e, (s, t) in _shifts_on(sd, base_week(), d).items():
                before[e] = before.get(e, 0.0) + paid_hours(t - s)
    overtime = 0.0
    for e, (s, t) in p.shifts.items():
        contract = sd.employee(e).contract_hours_week
        overtime += (max(0.0, before.get(e, 0.0) + paid_hours(t - s) - contract)
                     - max(0.0, before.get(e, 0.0) - contract))
    return {
        "date": p.day.isoformat(),
        "generated_at": generated_at(p.day),
        "status": "draft",
        "version": version,
        "demo_data": True,
        "opening": {"open": hh(RULES.open_hour), "close": hh(RULES.close_hour)},
        "conditions": i.conditions,
        "hours": [{"hour": hh(h), "customers": i.customers[h], "transactions": i.transactions[h],
                   "required": i.required[h], "scheduled": scheduled[h], "workload": i.workload[h]} for h in HOURS],
        "blocks": _blocks(i.required, scheduled),
        "shifts": shifts,
        "gaps": gaps,
        "kpis": {"labour_hours": round(labour, 1), "labour_cost_uah": round(cost),
                 "coverage_pct": round(100 * covered / req_total, 1),
                 "sales_per_labour_hour_uah": round(revenue / labour) if labour else 0,
                 "overtime_hours": round(overtime, 1), "rule_violations": len(violations(p))},
        "explain": _explain(sd, p, scheduled, gaps, event, absences),
        "changes": [{"at": generated_at(p.day), "by": "agent",
                     "summary": f"Drafted plan: {len(shifts)} shifts, {round(labour, 1)} labour hours, "
                                f"{round(100 * covered / req_total)}% of required hours covered"}],
    }


def _fmt(span: tuple[int, int] | None) -> str:
    return "off" if span is None else f"{hh(span[0])}-{hh(span[1])}"


def plan_diff(before: dict, after: dict, event: Event) -> list[dict]:
    sd = staff()
    b = {s["employee_id"]: s for s in before["shifts"]}
    a = {s["employee_id"]: s for s in after["shifts"]}
    out = []
    for eid in sorted(set(a) | set(b)):
        sb = (parse_hh(b[eid]["start"]), parse_hh(b[eid]["end"])) if eid in b else None
        sa = (parse_hh(a[eid]["start"]), parse_hh(a[eid]["end"])) if eid in a else None
        name = sd.employee(eid).name
        if sb != sa:
            if sa is None:
                why = "Called in sick: shift removed" if event.kind == "sick" and eid == event.employee_id else "Shift removed"
            elif sb is None:
                why = f"Called in to cover {_fmt(sa)} while the store is short"
            elif sa[0] <= sb[0] and sa[1] >= sb[1]:
                why = f"Shift extended from {_fmt(sb)} to {_fmt(sa)} to cover the shortfall"
            else:
                why = f"Shift moved from {_fmt(sb)} to {_fmt(sa)} to keep an opener, closer or lead on site"
            out.append({"employee_id": eid, "name": name, "before": _fmt(sb), "after": _fmt(sa), "why": why})
        elif [(t["from"], t["to"], t["station"]) for t in b[eid]["tasks"]] != [(t["from"], t["to"], t["station"]) for t in a[eid]["tasks"]]:
            moved = sorted({t["station"] for t in a[eid]["tasks"]} - {t["station"] for t in b[eid]["tasks"]}
                           or {t["station"] for t in a[eid]["tasks"]})
            why = {"air_alert": "Same shift; shelter duty during the alert, then tills for the rush",
                   "power": "Same shift; tasks moved to cash-only tills and manual checks during the power cut",
                   "traffic_spike": "Same shift; moved to the tills and floor for the spike"}.get(
                event.kind, "Same shift; tasks rearranged to cover the absence")
            out.append({"employee_id": eid, "name": name, "before": _fmt(sb), "after": _fmt(sa),
                        "why": why + f" ({', '.join(moved)})"})
    return out


@lru_cache(maxsize=16)
def base_plan(day: date) -> dict:
    return plan_document(base_week()[day])


@lru_cache(maxsize=1024)
def replan(day: date, event: Event) -> dict:
    doc = plan_document(replan_day(day, event), version=event.key, event=event)
    doc["diff"] = plan_diff(base_plan(day), doc, event)
    return doc


def event_from_version(day: date, version: str) -> Event | None:
    """'base' -> None; 'sick-E05' / 'power-12' -> the event. Raises EventError when unknown."""
    if version == "base":
        return None
    kind, _, arg = version.rpartition("-")
    if kind == "sick":
        return normalise_event(day, kind, arg, None, None)
    if not arg.isdigit():
        raise EventError(f"Unknown version {version}")
    return normalise_event(day, kind, None, hh(int(arg)), None)


def plan_for(day: date, version: str) -> dict:
    ev = event_from_version(day, version)
    return base_plan(day) if ev is None else replan(day, ev)


def all_events(day: date) -> list[Event]:
    """Every replan the planner offers for a day (the Worker serves these precomputed)."""
    evs = [Event("sick", employee_id=e.employee_id) for e in staff().employees]
    for kind in ("air_alert", "power", "traffic_spike"):
        evs += [normalise_event(day, kind, None, hh(h), None) for h in HOURS]
    return evs


