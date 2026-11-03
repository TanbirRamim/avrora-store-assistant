"""Greedy staffing with a repair pass, and an independent checker for the labour rules.

Hours are whole numbers (8 = 08:00). A shift is [start, end). The scheduler fills one day:

1. Start from the seed shifts (empty for a fresh plan; the approved plan minus the absent
   person for a replan, so people keep their shifts).
2. Repeatedly take the single change - a new shift or an extension of an existing one - that
   removes the most shortfall. Moving an existing shift is only allowed when it restores a
   hard rule (lead, opener or closer) and the net effect is still positive. Missing opener, closer or lead weighs 10, each missing person 1.
   Ties go to fewer idle hours, then non-leads (their hours are scarce), then lower cost.
3. Lookahead: if a hard rule is still unmet, try re-placing one shift and re-running step 2.
4. Repair: trim newly added hours that only add people above the requirement.

Every candidate shift already keeps the hard limits (availability, 8 h, weekly cap, 11 h rest),
so the greedy loop can only fail on coverage, which ``check_rules`` reports.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from avrora.config import RULES
from avrora.workforce.data import Employee
from avrora.workforce.model import HOURS

W_MANDATORY = 10.0


def paid_hours(span: int) -> float:
    return span - RULES.break_minutes / 60 if span > RULES.break_after_hours else float(span)


@dataclass
class Person:
    emp: Employee
    window: tuple[int, int] | None  # availability today, None = not available
    cap_left: float  # paid hours left this week (other days already counted)
    earliest: int = RULES.open_hour  # from 11 h rest after yesterday
    latest: int = RULES.close_hour  # from 11 h rest before tomorrow


@dataclass
class DaySchedule:
    shifts: dict[str, tuple[int, int]]
    required: dict[int, int]
    seed: dict[str, tuple[int, int]] = field(default_factory=dict)


def _bounds(p: Person) -> tuple[int, int] | None:
    if p.window is None:
        return None
    a = max(p.window[0], p.earliest, RULES.open_hour)
    b = min(p.window[1], p.latest, RULES.close_hour)
    return (a, b) if b > a else None


def candidates(p: Person, current: tuple[int, int] | None) -> list[tuple[int, int]]:
    """Feasible shifts for p: any 4-8 h window for a new shift; for an existing shift, any window
    of 1-8 h that still overlaps it (an extension, or a move the caller only accepts for a hard rule)."""
    b = _bounds(p)
    if b is None:
        return []
    out = []
    lo = RULES.min_shift_hours if current is None else 1
    for s in range(b[0], b[1]):
        for t in range(s + lo, min(b[1], s + RULES.max_shift_hours) + 1):
            if current and ((s, t) == current or t <= current[0] or s >= current[1]):
                continue
            if current and not (s <= current[0] and t >= current[1]) and t - s < RULES.min_shift_hours:
                continue
            if paid_hours(t - s) > p.cap_left + 1e-9:
                continue
            out.append((s, t))
    return out


class _State:
    def __init__(self, people: dict[str, Person], required: dict[int, int], shifts: dict[str, tuple[int, int]]):
        self.people, self.req, self.shifts = people, required, dict(shifts)
        self.cnt = {h: 0 for h in HOURS}
        self.lead = {h: 0 for h in HOURS}
        for eid, (s, t) in self.shifts.items():
            self._add(eid, s, t, 1)

    def _add(self, eid: str, s: int, t: int, sign: int) -> None:
        lead = self.people[eid].emp.lead
        for h in range(s, t):
            self.cnt[h] += sign
            self.lead[h] += sign * lead

    def opener(self) -> bool:
        return any(s == RULES.open_hour and self.people[e].emp.can_open for e, (s, _) in self.shifts.items())

    def closer(self) -> bool:
        return any(t == RULES.close_hour and self.people[e].emp.can_close for e, (_, t) in self.shifts.items())

    def gain(self, eid: str, s: int, t: int) -> tuple[float, int, float, float]:
        """Effect of setting eid's shift to [s, t): (weighted shortfall removed, idle hours added,
        staff part, mandatory part). Hours the change gives up count against it."""
        emp = self.people[eid].emp
        cur = self.shifts.get(eid)
        old = set(range(*cur)) if cur else set()
        new = set(range(s, t))
        mand = staff = 0.0
        idle = 0
        for h in new - old:
            useful = False
            if self.cnt[h] < self.req[h]:
                staff += 1
                useful = True
            if emp.lead and self.lead[h] == 0:
                mand += 1
                useful = True
            if self.cnt[h] < RULES.min_on_site:
                mand += 1
            idle += not useful
        for h in old - new:
            if self.cnt[h] <= self.req[h]:
                staff -= 1
            if emp.lead and self.lead[h] == 1:
                mand -= 1
            if self.cnt[h] <= RULES.min_on_site:
                mand -= 1
        others = [(e, x) for e, x in self.shifts.items() if e != eid]
        for flag, edge, ok in (("can_open", 0, RULES.open_hour), ("can_close", 1, RULES.close_hour)):
            before = any(x[edge] == ok and getattr(self.people[e].emp, flag) for e, x in self.shifts.items())
            after = any(x[edge] == ok and getattr(self.people[e].emp, flag) for e, x in others) \
                or ((s, t)[edge] == ok and getattr(emp, flag))
            mand += after - before
        return W_MANDATORY * mand + staff, idle, staff, mand

    def set(self, eid: str, s: int, t: int) -> None:
        if eid in self.shifts:
            self._add(eid, *self.shifts[eid], -1)
        self.shifts[eid] = (s, t)
        self._add(eid, s, t, 1)


    def bad(self) -> tuple[int, int]:
        """(hard-rule shortfalls, missing person-hours)."""
        mand = sum(self.lead[h] == 0 for h in HOURS) + sum(self.cnt[h] < RULES.min_on_site for h in HOURS)
        mand += (not self.opener()) + (not self.closer())
        return mand, sum(max(0, self.req[h] - self.cnt[h]) for h in HOURS)

    def copy(self) -> _State:
        return _State(self.people, self.req, self.shifts)


def _greedy(st: _State) -> None:
    while True:
        best, best_key = None, None
        for eid in sorted(st.people):
            p = st.people[eid]
            for s, t in candidates(p, st.shifts.get(eid)):
                g, idle, staff_only, mand = st.gain(eid, s, t)
                cur = st.shifts.get(eid)
                moved = cur is not None and not (s <= cur[0] and t >= cur[1])
                if g <= 0 or (moved and mand <= 0):
                    continue
                mand_part = W_MANDATORY * mand
                # leads' hours are needed for the lead rule on other days: discount their staff-only gain
                score = mand_part + staff_only * (0.75 if p.emp.lead else 1.0)
                key = (round(score - 0.2 * idle, 6), -idle, -p.emp.hourly_cost_uah * (t - s), p.cap_left)
                if best_key is None or key > best_key:
                    best, best_key = (eid, s, t), key
        if best is None:
            return
        st.set(*best)


def _lookahead(st: _State) -> _State:
    """When a hard rule is still unmet, try re-placing one shift anywhere it fits, let the greedy
    pass follow up, and keep the best result. Repeats while it helps (two-step fixes)."""
    for _ in range(4):
        if st.bad()[0] == 0:
            break
        best, best_bad = None, st.bad()
        for eid in sorted(st.people):
            for s, t in candidates(st.people[eid], None):
                if st.shifts.get(eid) == (s, t):
                    continue
                trial = st.copy()
                trial.set(eid, s, t)
                _greedy(trial)
                if trial.bad() < best_bad:
                    best, best_bad = trial, trial.bad()
        if best is None:
            break
        st = best
    return st


def schedule_day(people: dict[str, Person], required: dict[int, int],
                 seed: dict[str, tuple[int, int]] | None = None) -> DaySchedule:
    seed = dict(seed or {})
    st = _State(people, required, seed)
    _greedy(st)
    st = _lookahead(st)
    _repair(st, seed)
    return DaySchedule(shifts=dict(sorted(st.shifts.items())), required=required, seed=seed)


def _repair(st: _State, seed: dict[str, tuple[int, int]]) -> None:
    """Trim end or start hours that were added here and only add people above the requirement."""
    changed = True
    while changed:
        changed = False
        order = sorted(st.shifts, key=lambda e: (-st.people[e].emp.hourly_cost_uah, e))
        for eid in order:
            s, t = st.shifts[eid]
            keep = seed.get(eid)
            emp = st.people[eid].emp
            min_len = RULES.min_shift_hours if keep is None else 0
            for side in ("end", "start"):
                if t - s - 1 < max(min_len, 1):
                    break
                h = t - 1 if side == "end" else s
                if keep and keep[0] <= h < keep[1]:
                    continue
                if st.cnt[h] <= st.req[h] or (emp.lead and st.lead[h] <= 1):
                    continue
                if side == "end" and t == RULES.close_hour and emp.can_close and _sole(st, eid, "close"):
                    continue
                if side == "start" and s == RULES.open_hour and emp.can_open and _sole(st, eid, "open"):
                    continue
                if side == "end":
                    st.set(eid, s, t - 1)
                    t -= 1
                else:
                    st.set(eid, s + 1, t)
                    s += 1
                changed = True


def _sole(st: _State, eid: str, what: str) -> bool:
    if what == "open":
        return not any(e != eid and s == RULES.open_hour and st.people[e].emp.can_open for e, (s, _) in st.shifts.items())
    return not any(e != eid and t == RULES.close_hour and st.people[e].emp.can_close for e, (_, t) in st.shifts.items())


def check_rules(shifts: dict[str, tuple[int, int]], people: dict[str, Person], week_other: dict[str, float],
                prev_end: dict[str, int], next_start: dict[str, int]) -> list[str]:
    """Every labour rule, checked from scratch. Returns plain-language violations (empty = all kept).

    week_other: paid hours on the other days of the same week; prev_end / next_start: yesterday's
    end and tomorrow's start hour for the 11 h rest rule.
    """
    out = []
    cnt = {h: 0 for h in HOURS}
    lead = {h: 0 for h in HOURS}
    opener = closer = False
    for eid, (s, t) in shifts.items():
        p = people.get(eid)
        if p is None or p.window is None:
            out.append(f"{eid} is scheduled but not available")
            continue
        name = p.emp.name
        if not (p.window[0] <= s < t <= p.window[1]):
            out.append(f"{name} works outside availability")
        if s < RULES.open_hour or t > RULES.close_hour:
            out.append(f"{name} works outside opening hours")
        if t - s > RULES.max_shift_hours:
            out.append(f"{name}'s shift is longer than {RULES.max_shift_hours} h")
        if paid_hours(t - s) + week_other.get(eid, 0.0) > p.emp.week_cap + 1e-9:
            out.append(f"{name} goes over the weekly cap")
        if eid in prev_end and s + 24 - prev_end[eid] < RULES.min_rest_hours:
            out.append(f"{name} gets less than {RULES.min_rest_hours} h rest after yesterday")
        if eid in next_start and next_start[eid] + 24 - t < RULES.min_rest_hours:
            out.append(f"{name} gets less than {RULES.min_rest_hours} h rest before tomorrow")
        opener |= s == RULES.open_hour and p.emp.can_open
        closer |= t == RULES.close_hour and p.emp.can_close
        for h in range(s, t):
            cnt[h] += 1
            lead[h] += p.emp.lead
    if not opener:
        out.append("No one who can open starts at 08:00")
    if not closer:
        out.append("No one who can close stays until 21:00")
    for h in HOURS:
        if cnt[h] < RULES.min_on_site:
            out.append(f"Fewer than {RULES.min_on_site} people on site at {h:02d}:00")
        if lead[h] == 0:
            out.append(f"No shift lead or senior cashier at {h:02d}:00")
    return out
