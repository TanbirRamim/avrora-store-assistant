"""HTTP API for the manager app."""

from __future__ import annotations

import os
import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from enum import Enum
from functools import lru_cache
from typing import Literal

import httpx
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from avrora.actions.engine import Plan, build_plan
from avrora.actions.models import Action, ActionType
from avrora.ai.briefing import Briefing, build_briefing
from avrora.analytics.forecast import sales_history
from avrora.analytics.products import ProductFacts, build_products, store_feed
from avrora.analytics.purchases import purchase_history
from avrora.api.signals import router as signals_router
from avrora.api.wartime import router as wartime_router
from avrora.api.workforce import router as workforce_router
from avrora.config import SETTINGS
from avrora.data.loader import StoreData, load
from avrora.evaluation import evaluate

app = FastAPI(title="Avrora Store Assistant", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)
app.include_router(signals_router)
app.include_router(workforce_router)
app.include_router(wartime_router)

DB_PATH = SETTINGS.data_dir / "decisions.sqlite"


@lru_cache(maxsize=1)
def _data() -> StoreData:
    return load()


@lru_cache(maxsize=1)
def _plan() -> Plan:
    return build_plan(_data())


@lru_cache(maxsize=1)
def _briefing() -> Briefing:
    p = _plan()
    return build_briefing(p.actions, p.notices, SETTINGS.top_n)


@lru_cache(maxsize=1)
def _products() -> ProductFacts:
    return build_products(_data(), _plan())


def _db() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.execute("""CREATE TABLE IF NOT EXISTS decisions (
        action_id TEXT PRIMARY KEY, decision TEXT NOT NULL, reason TEXT, value REAL, decided_at TEXT NOT NULL)""")
    return con


# --------------------------------------------------------------------------- schemas


class Overview(BaseModel):
    store_name: str
    today: str
    products: int
    stockout_risks: int
    slow_stock_value_uah: float
    late_deliveries: int
    visibility_issues: int
    value_at_stake_uah: float


class BriefingOut(BaseModel):
    summary: str
    source: str
    priorities: list[Action]
    notices: list[Action]


class Point(BaseModel):
    date: str
    units_sold: int | None
    stock_end: int | None
    forecast: float | None


class ProductStatus(str, Enum):
    late = "late"
    running_out = "running_out"
    hard_to_find = "hard_to_find"
    overstocked = "overstocked"
    low = "low"
    on_order = "on_order"
    ok = "ok"


class NextDelivery(BaseModel):
    date: str
    qty: int
    late: bool


class ActionRef(BaseModel):
    id: str
    type: ActionType
    risk_uah: float


class ProductUpdate(BaseModel):
    date: str
    kind: str = Field(description="suggestion, late, expected, received, sold_out, no_sales or promotion")
    text: str


class StoreUpdate(ProductUpdate):
    product_id: str
    name: str


class ProductRow(BaseModel):
    product_id: str
    name: str
    category: str
    price: float
    supplier: str
    stock: int
    daily_sales: float = Field(description="Expected units a day, as the actions engine forecasts")
    days_cover: float | None = Field(description="Days the stock lasts; null when nothing sells")
    on_order: int
    next_delivery: NextDelivery | None
    sold_7d: int
    received_7d: int
    stock_change_7d: int | None
    last_sale: str | None
    status: ProductStatus
    attention: bool
    actions: list[ActionRef]


class ProductList(BaseModel):
    today: str
    last_day: str = Field(description="Last trading day in the data")
    products: list[ProductRow]
    updates: list[StoreUpdate]


class Purchase(BaseModel):
    id: str
    ordered: str
    expected: str
    received: str | None
    qty: int
    status: Literal["received", "late", "on_the_way"]
    days_late: int


class PurchaseSummary(BaseModel):
    orders: int
    units: int
    avg_lead_days: float | None
    on_time_pct: int | None
    last_received: str | None


class ProductDetail(BaseModel):
    product_id: str
    name: str
    category: str
    price: float
    supplier: str
    lead_time_days: int
    daily_forecast: float
    days_cover: float | None
    history: list[Point]
    # added for the Products screen; the fields above keep their meaning
    status: ProductStatus | None = None
    stock: int | None = None
    on_order: int | None = None
    next_delivery: NextDelivery | None = None
    sold_7d: int | None = None
    received_7d: int | None = None
    stock_change_7d: int | None = None
    last_sale: str | None = None
    actions: list[ActionRef] = []
    updates: list[ProductUpdate] = []
    # purchase history: supplier orders newest first, dates and quantities only (no costs in the data)
    purchases: list[Purchase] = []
    purchase_summary: PurchaseSummary | None = None


class Decision(str, Enum):
    approve = "approve"
    reject = "reject"
    change = "change"


class DecisionIn(BaseModel):
    action_id: str
    decision: Decision
    reason: str | None = Field(default=None, max_length=200)
    value: float | None = Field(default=None, ge=0, description="Changed quantity or discount")


class DecisionOut(DecisionIn):
    decided_at: str


class EvaluationOut(BaseModel):
    planted: int
    found: int
    precision: float
    recall: float
    missed: list[str]
    extra: list[str]


# --------------------------------------------------------------------------- routes


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/overview", response_model=Overview)
def overview() -> Overview:
    p = _plan()
    by = lambda t: [a for a in p.actions if a.type is t]
    return Overview(
        store_name=SETTINGS.store_name,
        today=SETTINGS.today.isoformat(),
        products=len(p.metrics),
        stockout_risks=len(by(ActionType.ORDER)),
        slow_stock_value_uah=round(sum(float(a.facts["stock_value"]) for a in by(ActionType.DISCOUNT)), 0),
        late_deliveries=len(by(ActionType.CHECK_DELIVERY)),
        visibility_issues=len(by(ActionType.MOVE_TO_FRONT)),
        value_at_stake_uah=round(sum(a.risk_uah for a in p.actions), 0),
    )


@app.get("/api/briefing", response_model=BriefingOut)
def briefing() -> BriefingOut:
    b = _briefing()
    return BriefingOut(summary=b.summary, source=b.source, priorities=b.priorities, notices=_plan().notices)


@app.get("/api/actions", response_model=list[Action])
def actions() -> list[Action]:
    return _plan().actions


@app.get("/api/products", response_model=ProductList)
def products() -> ProductList:
    f = _products()
    return ProductList(today=SETTINGS.today.isoformat(), last_day=_data().stock["date"].max().date().isoformat(),
                       products=f.rows, updates=store_feed(f, SETTINGS, _data().stock["date"].max()))


@app.get("/api/products/{product_id}", response_model=ProductDetail)
def product(product_id: str, days: int = 30) -> ProductDetail:
    m = _plan().metrics
    row = m[m["product_id"] == product_id]
    if row.empty:
        raise HTTPException(404, f"Unknown product {product_id}")
    r = row.iloc[0]
    hist = sales_history(_data(), product_id, days)
    points = [Point(date=d.date().isoformat(), units_sold=int(u), stock_end=int(s), forecast=None)
              for d, u, s in zip(hist["date"], hist["units_sold"], hist["stock_end"])]
    start = pd.Timestamp(SETTINGS.today)
    for i in range(14):  # forward forecast for the chart
        points.append(Point(date=(start + pd.Timedelta(days=i)).date().isoformat(),
                            units_sold=None, stock_end=None, forecast=round(float(r.base_rate), 2)))
    cover = float(r.days_cover)
    f = _products()
    extra = next(x for x in f.rows if x["product_id"] == product_id)
    keys = ("status", "stock", "on_order", "next_delivery", "sold_7d", "received_7d", "stock_change_7d",
            "last_sale", "actions")
    return ProductDetail(
        **{k: extra[k] for k in keys}, updates=f.updates[product_id],
        **purchase_history(_data().deliveries, product_id),
        product_id=product_id, name=r["name"], category=r.category, price=float(r.price),
        supplier=r.supplier, lead_time_days=int(r.lead_time_days), daily_forecast=round(float(r.base_rate), 2),
        days_cover=None if cover == float("inf") else round(cover, 1), history=points,
    )


@app.post("/api/decisions", response_model=DecisionOut)
def decide(body: DecisionIn) -> DecisionOut:
    known = {a.id for a in _plan().actions}
    if body.action_id not in known:
        raise HTTPException(404, f"Unknown action {body.action_id}")
    if body.decision is Decision.change and body.value is None:
        raise HTTPException(422, "A changed decision needs a value")
    out = DecisionOut(**body.model_dump(), decided_at=datetime.now(UTC).isoformat(timespec="seconds"))
    with closing(_db()) as con, con:
        con.execute("INSERT OR REPLACE INTO decisions VALUES (?,?,?,?,?)",
                    (out.action_id, out.decision.value, out.reason, out.value, out.decided_at))
    return out


@app.get("/api/decisions", response_model=list[DecisionOut])
def decisions() -> list[DecisionOut]:
    with closing(_db()) as con:
        rows = con.execute("SELECT action_id, decision, reason, value, decided_at FROM decisions "
                           "ORDER BY decided_at DESC").fetchall()
    return [DecisionOut(action_id=a, decision=d, reason=r, value=v, decided_at=t) for a, d, r, v, t in rows]


@app.delete("/api/decisions/{action_id}", status_code=204)
def undo(action_id: str) -> None:
    with closing(_db()) as con, con:
        con.execute("DELETE FROM decisions WHERE action_id = ?", (action_id,))


@app.get("/api/evaluation", response_model=EvaluationOut)
def evaluation() -> EvaluationOut:
    s = evaluate(_plan())
    return EvaluationOut(planted=s.planted, found=s.found, precision=s.precision, recall=s.recall,
                         missed=s.missed, extra=s.extra)


ALERTS_URL = "https://api.alerts.in.ua/v1/alerts/active.json"


def summarise_alerts(alerts: list[dict], fetched_at: str) -> dict:
    """Oblast-level (and Kyiv city) titles versus community titles, as cloudflare/src/wartime.ts does."""
    oblasts: set[str] = set()
    hromadas: set[str] = set()
    for a in alerts:
        title, kind = a.get("location_title"), a.get("location_type")
        if not title:
            continue
        if kind in ("oblast", "city"):
            oblasts.add(title)
        elif kind in ("hromada", "community"):
            hromadas.add(title)
    return {"connected": True, "source": "alerts.in.ua", "fetched_at": fetched_at,
            "oblasts": sorted(oblasts), "hromadas": sorted(hromadas)}


@app.get("/api/wartime/alerts")
def wartime_alerts() -> dict:
    """Live air-raid alerts for the map's war-time mode. Needs ALERTS_IN_UA_TOKEN; never simulated."""
    token = os.getenv("ALERTS_IN_UA_TOKEN", "")
    if not token:
        return {"connected": False, "reason": "no_token"}
    try:
        r = httpx.get(ALERTS_URL, headers={"Authorization": f"Bearer {token}"}, timeout=8)
        r.raise_for_status()
        alerts = r.json().get("alerts", [])
    except (httpx.HTTPError, ValueError):
        return {"connected": False, "reason": "unavailable"}
    return summarise_alerts(alerts, datetime.now(UTC).isoformat())
