"""Hourly traffic forecast and the workload model: how many people each open hour needs."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, timedelta
from functools import lru_cache

from avrora.config import RULES, SETTINGS
from avrora.workforce.data import StaffData

TASKS = ("checkout", "receiving", "replenishment", "merchandising", "customer_service")
HOURS = list(range(RULES.open_hour, RULES.close_hour))
SERVICE_H_PER_CUSTOMER = 0.02  # 1.2 minutes of floor help per customer
DELIVERY_WINDOW = (8, 11)
MERCH_WINDOW = (9, 13)
POWER_CHECKOUT_FACTOR = 0.7  # fewer tills and slower card terminals on the generator
AIR_ALERT_REBOUND = 1.3  # pent-up customers in the hour after an alert
SPIKE_FACTOR = 1.5
EVENT_HOURS = {"air_alert": 2, "power": 4, "traffic_spike": 3}  # replan presets
EVENT_KINDS = ("sick", "air_alert", "power", "traffic_spike")


def hh(h: int) -> str:
    return f"{h:02d}:00"


def parse_hh(s: str) -> int:
    return int(s.split(":")[0])


@dataclass(frozen=True)
class Event:
    """A continuity event for a replan. Windows are whole hours; sick covers the whole day."""

    kind: str
    employee_id: str | None = None
    start: int | None = None
    end: int | None = None

    @property
    def key(self) -> str:
        return f"sick-{self.employee_id}" if self.kind == "sick" else f"{self.kind}-{self.start:02d}"


@dataclass
class Rates:
    tx_per_checkout_hour: float
    cases_per_hour: float
    units_per_replen_hour: float
    basket: float
    price_per_unit: float


@dataclass
class DayInputs:
    day: date
    customers: dict[int, int]
    transactions: dict[int, int]
    units: dict[int, float]
    workload: dict[int, dict[str, float]]
    required: dict[int, int]
    conditions: list[dict] = field(default_factory=list)
    delivery_cases: int = 0
    alert: tuple[int, int] | None = None


def team_rates(sd: StaffData, today: date = SETTINGS.today) -> Rates:
    perf = sd.performance
    recent = perf[perf["week_start"] >= (today - timedelta(weeks=4)).isoformat()]
    pos = lambda col: float(recent.loc[recent[col] > 0, col].mean())
    sales = sd.sales.merge(sd.products[["product_id", "price"]], on="product_id")
    last = sales[sales["date"] >= (today - timedelta(days=28)).isoformat()]
    tr = sd.traffic[sd.traffic["date"] >= (today - timedelta(days=28)).isoformat()]
    basket = float(last["units_sold"].sum()) / float(tr["transactions"].sum())
    price = float((last["units_sold"] * last["price"]).sum()) / float(last["units_sold"].sum())
    return Rates(tx_per_checkout_hour=pos("items_scanned_per_hour") / basket, cases_per_hour=pos("cases_received_per_hour"),
                 units_per_replen_hour=pos("shelves_replenished_per_hour"), basket=basket, price_per_unit=price)


@lru_cache(maxsize=1)
def _actions_today() -> int:
    """Markdowns and move-to-front actions the action engine raised for today (shelf work)."""
    from avrora.actions.engine import build_plan
    from avrora.actions.models import ActionType
    from avrora.data.loader import load

    return sum(a.type in (ActionType.DISCOUNT, ActionType.MOVE_TO_FRONT) for a in build_plan(load()).actions)


def _baseline(sd: StaffData, day: date) -> tuple[dict[int, float], dict[int, float]]:
    """Mean customers and transactions per hour on the last 4 undisrupted days with the same weekday."""
    disrupted = set(sd.windows["date"])
    t = sd.traffic
    same = sorted({d for d in t["date"] if date.fromisoformat(d).weekday() == day.weekday()
                   and d not in disrupted and d < SETTINGS.today.isoformat()})[-4:]
    sub = t[t["date"].isin(same)].groupby("hour")[["customers", "transactions"]].mean()
    return sub["customers"].to_dict(), sub["transactions"].to_dict()


def day_inputs(sd: StaffData, day: date, event: Event | None = None) -> DayInputs:
    rates = team_rates(sd)
    cust, tx = _baseline(sd, day)
    factor = {h: 1.0 for h in HOURS}
    checkout_factor = {h: 1.0 for h in HOURS}
    conditions: list[dict] = []
    merch = 0.5
    cases = 0
    cal = sd.calendar[sd.calendar["date"] == day.isoformat()]
    for _, c in cal.iterrows():
        a, b = parse_hh(c["from"]), parse_hh(c["to"])
        conditions.append({"kind": c.kind, "label": c.label, "from": c["from"], "to": c["to"]})
        if c.kind == "promotion":
            for h in HOURS:
                factor[h] *= float(c.value)
            prev = sd.calendar[(sd.calendar["date"] == (day - timedelta(days=1)).isoformat())
                               & (sd.calendar["kind"] == "promotion")]
            merch += 1.0 if len(prev) else 3.0  # first day: set up the displays
        elif c.kind == "power":
            for h in range(a, b):
                factor[h] *= float(c.value)
                checkout_factor[h] *= POWER_CHECKOUT_FACTOR
        elif c.kind == "delivery":
            cases += int(c.value)
    dl = sd.deliveries.merge(sd.products[["product_id", "case_pack"]], on="product_id")
    due = dl[(dl["expected_date"] == day.isoformat()) & dl["actual_date"].isna()]
    supplier_cases = math.ceil(float((due["quantity"] / due["case_pack"]).sum()))
    if supplier_cases:
        conditions.append({"kind": "delivery", "label": f"{len(due)} supplier deliveries due ({supplier_cases} cases)",
                           "from": hh(DELIVERY_WINDOW[0]), "to": hh(DELIVERY_WINDOW[1])})
    cases += supplier_cases
    if day == SETTINGS.today:
        merch += 0.25 * _actions_today()

    alert = None
    if event and event.kind != "sick":
        a, b = event.start, event.end
        label = {"air_alert": "Air-raid alert: store closes, everyone to the shelter",
                 "power": "Power cut (manager re-plan): tills on the generator",
                 "traffic_spike": "Traffic spike: 50% more customers than forecast"}[event.kind]
        conditions.append({"kind": "air_alert" if event.kind == "air_alert" else "power" if event.kind == "power"
                           else "promotion", "label": label, "from": hh(a), "to": hh(b)})
        for h in range(a, b):
            if event.kind == "air_alert":
                factor[h] = 0.0
            elif event.kind == "power":
                factor[h] *= 0.6
                checkout_factor[h] = min(checkout_factor[h], POWER_CHECKOUT_FACTOR)
            else:
                factor[h] *= SPIKE_FACTOR
        if event.kind == "air_alert":
            alert = (a, b)
            if b in factor:
                factor[b] *= AIR_ALERT_REBOUND

    out = DayInputs(day=day, customers={}, transactions={}, units={}, workload={}, required={},
                    conditions=sorted(conditions, key=lambda c: (c["from"], c["kind"])), delivery_cases=cases, alert=alert)
    span_d = DELIVERY_WINDOW[1] - DELIVERY_WINDOW[0]
    span_m = MERCH_WINDOW[1] - MERCH_WINDOW[0]
    for h in HOURS:
        c = round(cust[h] * factor[h])
        x = min(c, round(tx[h] * factor[h]))
        units = x * rates.basket
        in_alert = alert is not None and alert[0] <= h < alert[1]
        w = {
            "checkout": x / (rates.tx_per_checkout_hour * checkout_factor[h]),
            "receiving": 0.0 if in_alert or not DELIVERY_WINDOW[0] <= h < DELIVERY_WINDOW[1]
            else cases / rates.cases_per_hour / span_d,
            "replenishment": units / rates.units_per_replen_hour,
            "merchandising": merch / span_m if MERCH_WINDOW[0] <= h < MERCH_WINDOW[1] and not in_alert else 0.0,
            "customer_service": c * SERVICE_H_PER_CUSTOMER,
        }
        out.customers[h], out.transactions[h], out.units[h] = c, x, units
        out.workload[h] = {k: round(v, 2) for k, v in w.items()}
        out.required[h] = max(RULES.min_on_site, math.ceil(sum(w.values()) / RULES.utilisation - 1e-9))
    return out
