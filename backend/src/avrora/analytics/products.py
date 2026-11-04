"""Every product's stock status and recent changes, for the Products screen.

Status comes from the action engine first, so a product with an open suggestion
always shows the same problem as Today. Products without a suggestion are Low,
On order or OK by their reorder point. All numbers come from the store data.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import pandas as pd

from avrora.actions.engine import Plan
from avrora.actions.models import Action, ActionType
from avrora.config import SETTINGS, Settings
from avrora.data.loader import StoreData

# Highest first: the status a product shows when it has more than one suggestion.
STATUS_BY_ACTION = {
    ActionType.CHECK_DELIVERY: "late",
    ActionType.ORDER: "running_out",
    ActionType.MOVE_TO_FRONT: "hard_to_find",
    ActionType.DISCOUNT: "overstocked",
}
STATUS_ORDER = ["late", "running_out", "hard_to_find", "overstocked", "low", "on_order", "ok"]
ATTENTION = {"late", "running_out", "hard_to_find", "overstocked", "low"}

RECENT_DAYS = 7  # stock movement and sales totals
FEED_DAYS = 14  # how far back the per-product feed reaches
PROMO_DAYS = 45  # promotions are rarer, so look further back
QUIET_EXPECTED = 3.0  # a gap with no sale is news once about this many sales were expected in it


def _d(ts: pd.Timestamp) -> str:
    return ts.date().isoformat()


def _short(ts: pd.Timestamp) -> str:
    return f"{ts.day} {ts.strftime('%b')}"


def proposal_text(a: Action) -> str:
    """Same wording as the app's proposalText (frontend/src/lib/format.ts)."""
    p = a.proposal
    if a.type is ActionType.ORDER:
        return f"Order {p['order_qty']} from {p['supplier']}"
    if a.type is ActionType.DISCOUNT:
        return f"{p['discount_pct']}% off until stock clears"
    if a.type is ActionType.MOVE_TO_FRONT:
        return "Move to a visible shelf"
    return str(p["step"])


@dataclass
class ProductFacts:
    rows: list[dict]  # one per product, list order = needs attention first
    updates: dict[str, list[dict]]  # product_id -> feed, newest first
    last_day: pd.Timestamp | None = None  # last closed trading day


def build_products(data: StoreData, plan: Plan, settings: Settings = SETTINGS) -> ProductFacts:
    today = pd.Timestamp(settings.today)
    last_day = data.stock["date"].max()  # last closed trading day
    week_ago = last_day - pd.Timedelta(days=RECENT_DAYS)
    m = plan.metrics.set_index("product_id")

    by_product: dict[str, list[Action]] = {}
    for a in plan.actions:
        by_product.setdefault(a.product_id, []).append(a)

    sales = data.sales
    stock = data.stock.pivot(index="product_id", columns="date", values="stock_end")
    sold_7d = sales[sales["date"] > week_ago].groupby("product_id")["units_sold"].sum()
    last_sale = sales[sales["units_sold"] > 0].groupby("product_id")["date"].max()

    d = data.deliveries
    received = d[d["actual_date"].notna()]
    received_7d = received[received["actual_date"] > week_ago].groupby("product_id")["quantity"].sum()
    open_orders = d[d["actual_date"].isna()].sort_values("expected_date")

    promos = data.events[data.events["type"] == "promotion"]

    rows, updates = [], {}
    for pid, r in m.iterrows():
        acts = sorted(by_product.get(pid, []), key=lambda a: STATUS_ORDER.index(STATUS_BY_ACTION[a.type]))
        cover = float(r.days_cover)
        cover_out = None if not math.isfinite(cover) else round(cover, 1)
        on_order = int(r.on_order)
        if acts:
            status = STATUS_BY_ACTION[acts[0].type]
        elif r.base_rate > 0 and r.stock <= r.reorder_point:
            status = "on_order" if on_order > 0 else "low"
        else:
            status = "ok"

        mine = open_orders[open_orders["product_id"] == pid]
        nxt = None
        if not mine.empty:
            o = mine.iloc[0]
            nxt = {"date": _d(o.expected_date), "qty": int(o.quantity), "late": bool(o.expected_date < today)}

        ls = last_sale.get(pid)
        s7_start = (int(stock.at[pid, week_ago]) if week_ago in stock.columns and pid in stock.index
                    and pd.notna(stock.at[pid, week_ago]) else None)
        stock_now = int(r.stock)
        row = {
            "product_id": pid,
            "name": r["name"],
            "category": r.category,
            "price": float(r.price),
            "supplier": r.supplier,
            "stock": stock_now,
            "daily_sales": round(float(r.base_rate), 1),
            "days_cover": cover_out,
            "on_order": on_order,
            "next_delivery": nxt,
            "sold_7d": int(sold_7d.get(pid, 0)),
            "received_7d": int(received_7d.get(pid, 0)),
            "stock_change_7d": None if s7_start is None else stock_now - s7_start,
            "last_sale": None if ls is None else _d(ls),
            "status": status,
            "attention": status in ATTENTION,
            "actions": [{"id": a.id, "type": a.type.value, "risk_uah": a.risk_uah} for a in acts],
        }
        rows.append(row)
        updates[pid] = _feed(pid, row, acts, received, mine, promos,
                         stock.loc[pid].dropna() if pid in stock.index else pd.Series(dtype=float, index=pd.DatetimeIndex([])),
                         today, last_day, r.supplier)

    # products with a suggestion by money at stake (as Today ranks them), then Low, On order, OK
    rank = lambda row: (0 if row["actions"] else STATUS_ORDER.index(row["status"]),
                        -sum(a["risk_uah"] for a in row["actions"]),
                        row["days_cover"] if row["days_cover"] is not None else 1e9, row["name"])
    rows.sort(key=rank)
    return ProductFacts(rows=rows, updates=updates, last_day=last_day)


def _feed(pid, row, acts, received, mine, promos, stock: pd.Series, today, last_day, supplier) -> list[dict]:
    """Plain-language changes for one product, newest first. Future deliveries come first."""
    out: list[dict] = []
    add = lambda date, kind, text: out.append({"date": _d(date), "kind": kind, "text": text})

    for a in acts:
        add(today, "suggestion", f"Suggested today: {proposal_text(a)}")

    for o in mine.itertuples(index=False):
        if o.expected_date < today:
            late = (today - o.expected_date).days
            add(o.expected_date, "late",
                f"{int(o.quantity)} units from {supplier} were due {_short(o.expected_date)}, "
                f"{late} {'day' if late == 1 else 'days'} late")
        else:
            add(o.expected_date, "expected", f"{int(o.quantity)} units from {supplier} due {_short(o.expected_date)}")

    since = last_day - pd.Timedelta(days=FEED_DAYS)
    got = received[(received["product_id"] == pid) & (received["actual_date"] > since)]
    for o in got.itertuples(index=False):
        add(o.actual_date, "received", f"Received {int(o.quantity)} units from {supplier}")

    recent = stock[stock.index > since]
    prev = stock[stock.index <= since]
    was = int(prev.iloc[-1]) if len(prev) else None
    for day, v in recent.items():
        if v == 0 and was not in (0, None):
            add(day, "sold_out", "Sold out" + (", still none in stock" if row["stock"] == 0 else ""))
        was = int(v)

    if row["last_sale"] is None:
        add(last_day, "no_sales", "No sales in the last 90 days")
    else:
        ls = pd.Timestamp(row["last_sale"])
        quiet = (last_day - ls).days
        rate = float(row["daily_sales"])
        if quiet >= 2 and quiet * rate >= QUIET_EXPECTED and row["stock"] > 0:
            add(ls, "no_sales", f"No sale since {_short(ls)} with {row['stock']} in stock; "
                f"usually sells about {rate:.1f} a day")

    p = promos[(promos["product_id"] == pid) & (promos["date"] > last_day - pd.Timedelta(days=PROMO_DAYS))]
    if not p.empty:
        start, end = p["date"].min(), p["date"].max()
        add(end, "promotion", f"Promotion ran {_short(start)} to {_short(end)}")

    out.sort(key=lambda u: u["date"], reverse=True)
    return out


STORE_FEED_KINDS = {"late", "expected", "received", "sold_out", "no_sales"}
STORE_FEED_DAYS = 3  # deliveries received this recently show in the store-wide feed
STORE_FEED_AHEAD = 7  # expected deliveries this far ahead


def store_feed(facts: ProductFacts, settings: Settings = SETTINGS, last_day: pd.Timestamp | None = None) -> list[dict]:
    """Store-wide recent changes: problems at any age in the feed window, routine deliveries only lately."""
    today = pd.Timestamp(settings.today)
    last_day = last_day if last_day is not None else (facts.last_day if facts.last_day is not None else today - pd.Timedelta(days=1))
    names = {r["product_id"]: r["name"] for r in facts.rows}
    out = []
    for pid, items in facts.updates.items():
        for u in items:
            day = pd.Timestamp(u["date"])
            keep = u["kind"] in {"late", "sold_out", "no_sales"} or (
                u["kind"] == "received" and day > last_day - pd.Timedelta(days=STORE_FEED_DAYS)
            ) or (u["kind"] == "expected" and day <= today + pd.Timedelta(days=STORE_FEED_AHEAD))
            if u["kind"] in STORE_FEED_KINDS and keep:
                out.append({**u, "product_id": pid, "name": names[pid]})
    # problems first, newest first; then what arrived lately; then deliveries soonest first
    group = {"late": 0, "sold_out": 1, "no_sales": 2, "received": 3, "expected": 4}
    out.sort(key=lambda u: (u["name"]))
    out.sort(key=lambda u: pd.Timestamp(u["date"]).value * (1 if u["kind"] == "expected" else -1))
    out.sort(key=lambda u: group[u["kind"]])
    return out
