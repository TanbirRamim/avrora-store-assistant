"""Turn product metrics into ranked, explainable actions.

Every rule and every number here is deterministic. The AI layer may
re-order the top of this list and rewrite the reasons, but it never
creates actions or numbers of its own.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from avrora.actions.models import Action, ActionType
from avrora.analytics.forecast import (
    clean_sales,
    disrupted_days,
    product_metrics,
    weekday_index,
)
from avrora.config import SETTINGS, Settings
from avrora.data.loader import StoreData

# Money at stake over the next 30 days, as a share of the goods' value.
# Lost sales count in full; slow stock and late goods cost less per month.
MARKDOWN_RISK_SHARE = 0.10  # slow stock: expected extra markdown if left another month
DELAY_RISK_SHARE = 0.10  # late delivery: disruption cost of goods not on the shelf


@dataclass
class Plan:
    actions: list[Action]  # all actions, highest risk first
    notices: list[Action]  # explained anomalies that need no action
    metrics: pd.DataFrame


def _a(kind: ActionType, row, risk: float, facts: dict, proposal: dict, reason: str) -> Action:
    return Action(
        id=f"{kind.value}-{row.product_id}",
        type=kind,
        product_id=row.product_id,
        product_name=row.name,
        category=row.category,
        risk_uah=round(float(risk), 2),
        facts=facts,
        proposal=proposal,
        reason=reason,
    )


def _order_and_delivery(m: pd.DataFrame) -> list[Action]:
    out = []
    for r in m.itertuples(index=False):
        if r.overdue_qty > 0:
            risk = r.overdue_qty * r.price * DELAY_RISK_SHARE
            out.append(_a(ActionType.CHECK_DELIVERY, r, risk,
                          {"overdue_qty": int(r.overdue_qty), "overdue_days": int(r.overdue_days),
                           "days_cover": round(r.days_cover, 1), "supplier": r.supplier},
                          {"step": f"Contact {r.supplier} about {int(r.overdue_qty)} units"},
                          f"Delivery of {int(r.overdue_qty)} units from {r.supplier} is "
                          f"{int(r.overdue_days)} days late."))
            continue
        runs_out_before_delivery = r.base_rate > 0 and r.days_cover < r.lead_time_days + 1
        if runs_out_before_delivery and r.order_qty > 0:
            missing_days = max(r.lead_time_days - r.days_cover, 0.5)
            risk = r.base_rate * missing_days * r.price
            out.append(_a(ActionType.ORDER, r, risk,
                          {"stock": int(r.stock), "daily_sales": round(r.base_rate, 1),
                           "days_cover": round(r.days_cover, 1), "lead_time_days": int(r.lead_time_days),
                           "on_order": int(r.on_order)},
                          {"order_qty": int(r.order_qty), "supplier": r.supplier},
                          f"{int(r.stock)} left at about {r.base_rate:.1f} a day: runs out in "
                          f"{r.days_cover:.1f} days, delivery takes {int(r.lead_time_days)} days."))
    return out


def _discounts(m: pd.DataFrame, s: Settings) -> list[Action]:
    out = []
    for r in m.itertuples(index=False):
        excess = r.stock - r.base_rate * s.target_cover_days
        if r.days_cover > s.overstock_cover_days and excess >= 2 * r.case_pack:
            risk = excess * r.price * MARKDOWN_RISK_SHARE
            pct = 30 if r.days_cover > 180 else 20
            cover = "over a year" if r.days_cover > 365 else f"{r.days_cover:.0f} days"
            out.append(_a(ActionType.DISCOUNT, r, risk,
                          {"stock": int(r.stock), "daily_sales": round(r.base_rate, 2),
                           "days_cover": round(min(r.days_cover, 9999), 0), "stock_value": round(r.stock_value, 0)},
                          {"discount_pct": pct},
                          f"{int(r.stock)} in stock but only {r.base_rate:.1f} sold a day: enough for {cover}."))
    return out


def _visibility(data: StoreData, m: pd.DataFrame, s: Settings) -> list[Action]:
    today = pd.Timestamp(s.today)
    c = clean_sales(data)
    recent = c[c["date"] >= today - pd.Timedelta(days=14)].groupby("product_id")["deseasoned"].mean()
    base = c[(c["date"] >= today - pd.Timedelta(days=75)) & (c["date"] < today - pd.Timedelta(days=22))]
    base = base.groupby("product_id")["deseasoned"].mean()
    out = []
    for r in m.itertuples(index=False):
        b, now = base.get(r.product_id, 0.0), recent.get(r.product_id, 0.0)
        if b >= s.visibility_min_baseline and now < s.visibility_drop_ratio * b and r.stock >= b * 7:
            risk = (b - now) * 14 * r.price
            drop = round((1 - now / b) * 100)
            out.append(_a(ActionType.MOVE_TO_FRONT, r, risk,
                          {"usual_daily_sales": round(b, 1), "recent_daily_sales": round(now, 1),
                           "drop_pct": drop, "stock": int(r.stock)},
                          {"step": "Check shelf placement and move to a visible spot"},
                          f"Sales fell {drop}% in two weeks while {int(r.stock)} are in stock: "
                          "likely hard to find."))
    return out


def _store_anomalies(data: StoreData, s: Settings) -> list[Action]:
    today = pd.Timestamp(s.today)
    skip = disrupted_days(data.events)
    wk = weekday_index(data.sales, skip)
    daily = data.sales.groupby("date")["units_sold"].sum()
    normal = daily[~daily.index.isin(skip)]
    out = []
    for day in daily.index[daily.index >= today - pd.Timedelta(days=7)]:
        ref = normal[(normal.index < day) & (normal.index >= day - pd.Timedelta(days=28))]
        ref_idx = ref.index.day_of_week.map(wk)
        expected = (ref / ref_idx.values).mean() * wk[day.day_of_week]
        actual = daily[day]
        if actual >= (1 - s.anomaly_drop_ratio) * expected:
            continue
        ev = data.events[(data.events["date"] == day) & data.events["type"].isin(["power_outage", "air_raid_alert"])]
        cause = None if ev.empty else ev.iloc[0]
        drop = round((1 - actual / expected) * 100)
        label = day.strftime("%a %d %b")
        reason = (f"Sales on {label} were {drop}% below normal during a {cause.type.replace('_', ' ')} "
                  f"lasting {int(cause.hours)} hours. No action needed."
                  if cause is not None else f"Sales on {label} were {drop}% below normal with no known cause.")
        out.append(Action(
            id=f"EXPLAIN_ANOMALY-{day.date()}", type=ActionType.EXPLAIN_ANOMALY, product_id="STORE",
            product_name="Whole store", category="Store", risk_uah=0.0,
            facts={"date": str(day.date()), "expected_units": round(expected), "actual_units": int(actual),
                   "drop_pct": drop, "cause": "unknown" if cause is None else cause.type},
            proposal={"step": "No action" if cause is not None else "Investigate"},
            reason=reason,
        ))
    return out


def build_plan(data: StoreData, settings: Settings = SETTINGS) -> Plan:
    m = product_metrics(data, settings)
    actions = _order_and_delivery(m) + _discounts(m, settings) + _visibility(data, m, settings)
    actions.sort(key=lambda a: a.risk_uah, reverse=True)
    return Plan(actions=actions, notices=_store_anomalies(data, settings), metrics=m)
