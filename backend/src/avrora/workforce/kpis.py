"""KPI feedback for the workforce agent: how the last 4 weeks of staffing went.

History (shifts.csv, traffic.csv, sales.csv) gives the past weeks; the required staff per hour comes
from the same workload model as the planner, applied to the traffic that actually happened. The
current week comes from the agent's plans. Approvals, rejections and replans come from the
workforce_audit table, so they are counted at request time (see api.workforce.kpis).
"""

from __future__ import annotations

import math
from datetime import date, datetime, timedelta
from functools import lru_cache

from avrora.config import RULES, SETTINGS
from avrora.workforce.data import staff
from avrora.workforce.model import (
    DELIVERY_WINDOW,
    HOURS,
    MERCH_WINDOW,
    SERVICE_H_PER_CUSTOMER,
    team_rates,
)
from avrora.workforce.scheduler import paid_hours

WEEKS = 4


def _monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _row(week_start: date, required: int, planned: int, covered: int, labour: float, sales: float, source: str) -> dict:
    return {
        "week_start": week_start.isoformat(),
        "week_end": (week_start + timedelta(days=6)).isoformat(),
        "source": source,
        "required_hours": required,
        "planned_hours": planned,
        "coverage_pct": round(100 * covered / required, 1) if required else 100.0,
        "labour_hours": round(labour, 1),
        "sales_uah": round(sales),
        "sales_per_labour_hour_uah": round(sales / labour) if labour else 0,
    }


@lru_cache(maxsize=1)
def history_weeks(today: date = SETTINGS.today) -> list[dict]:
    """The 4 full weeks before this one, from what was actually worked and sold."""
    sd = staff()
    rates = team_rates(sd)
    traffic = sd.traffic.set_index(["date", "hour"])
    sales = sd.sales.merge(sd.products[["product_id", "price", "case_pack"]], on="product_id")
    sales_by_day = (sales["units_sold"] * sales["price"]).groupby(sales["date"]).sum().to_dict()
    dl = sd.deliveries.dropna(subset=["actual_date"]).merge(sd.products[["product_id", "case_pack"]], on="product_id")
    cases_by_day = (dl["quantity"] / dl["case_pack"]).groupby(dl["actual_date"]).sum().to_dict()
    shifts = sd.shifts
    span_d = DELIVERY_WINDOW[1] - DELIVERY_WINDOW[0]
    span_m = MERCH_WINDOW[1] - MERCH_WINDOW[0]
    out = []
    this_monday = _monday(today)
    for k in range(WEEKS, 0, -1):
        start = this_monday - timedelta(weeks=k)
        required = planned = covered = 0
        labour = revenue = 0.0
        for i in range(7):
            d = (start + timedelta(days=i)).isoformat()
            day_shifts = [(int(s[:2]), int(t[:2])) for s, t in shifts.loc[shifts["date"] == d, ["start", "end"]].itertuples(index=False)]
            labour += sum(paid_hours(t - s) for s, t in day_shifts)
            revenue += float(sales_by_day.get(d, 0.0))
            cases = math.ceil(float(cases_by_day.get(d, 0.0)))
            for h in HOURS:
                if (d, h) not in traffic.index:
                    continue
                c, x = (int(v) for v in traffic.loc[(d, h), ["customers", "transactions"]])
                w = (x / rates.tx_per_checkout_hour + x * rates.basket / rates.units_per_replen_hour
                     + c * SERVICE_H_PER_CUSTOMER
                     + (cases / rates.cases_per_hour / span_d if DELIVERY_WINDOW[0] <= h < DELIVERY_WINDOW[1] else 0.0)
                     + (0.5 / span_m if MERCH_WINDOW[0] <= h < MERCH_WINDOW[1] else 0.0))
                req = max(RULES.min_on_site, math.ceil(w / RULES.utilisation - 1e-9))
                sched = sum(s <= h < t for s, t in day_shifts)
                required += req
                planned += sched
                covered += min(req, sched)
        out.append(_row(start, required, planned, covered, labour, revenue, "history"))
    return out


def plan_week(plans: list[dict]) -> dict:
    """This week as the agent planned it (base drafts for the days ahead)."""
    required = sum(h["required"] for p in plans for h in p["hours"])
    planned = sum(h["scheduled"] for p in plans for h in p["hours"])
    covered = sum(min(h["required"], h["scheduled"]) for p in plans for h in p["hours"])
    labour = sum(p["kpis"]["labour_hours"] for p in plans)
    sales = sum(p["kpis"]["labour_hours"] * p["kpis"]["sales_per_labour_hour_uah"] for p in plans)
    return _row(date.fromisoformat(plans[0]["date"]), required, planned, covered, labour, sales, "plan")


def decisions(rows: list[tuple[str, str]], now: datetime) -> dict:
    """rows: (action, at ISO) from workforce_audit. Counts the last 28 days, by week of the decision."""
    since = (now - timedelta(weeks=WEEKS)).replace(microsecond=0)
    weeks: dict[str, dict] = {}
    total = {"approved": 0, "rejected": 0, "replans": 0}
    for action, at in rows:
        t = datetime.fromisoformat(at)
        if t < since:
            continue
        field = {"approved": "approved", "rejected": "rejected", "drafted": "replans"}.get(action)
        if field is None:
            continue
        ws = _monday(t.date()).isoformat()
        weeks.setdefault(ws, {"week_start": ws, "approved": 0, "rejected": 0, "replans": 0})[field] += 1
        total[field] += 1
    decided = total["approved"] + total["rejected"]
    return {"since": since.isoformat(), **total,
            "approval_rate_pct": round(100 * total["approved"] / decided, 1) if decided else None,
            "by_week": [weeks[k] for k in sorted(weeks)]}
