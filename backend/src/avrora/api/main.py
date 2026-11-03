"""HTTP API for the manager app."""

from __future__ import annotations

import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from enum import Enum
from functools import lru_cache

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from avrora.actions.engine import Plan, build_plan
from avrora.actions.models import Action, ActionType
from avrora.ai.briefing import Briefing, build_briefing
from avrora.analytics.forecast import sales_history
from avrora.api.signals import router as signals_router
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
    return ProductDetail(
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
