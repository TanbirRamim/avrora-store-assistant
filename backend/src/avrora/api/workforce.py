"""Workforce agent routes: staffing plans, replans, approvals and employee profiles.

The agent drafts; the manager approves or rejects. Every replan, approval and rejection is
written to the workforce_audit table (sqlite here, D1 in the Worker) and shown as `changes`.
"""

from __future__ import annotations

import sqlite3
from contextlib import closing
from datetime import UTC, date, datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from avrora.config import SETTINGS
from avrora.workforce.kpis import decisions, history_weeks, plan_week
from avrora.workforce.people import employee_list, employee_profile
from avrora.workforce.plan import (
    EventError,
    event_from_version,
    event_label,
    normalise_event,
    plan_dates,
    plan_for,
    replan,
)

router = APIRouter(prefix="/api/workforce", tags=["workforce"])

AUDIT_SQL = """CREATE TABLE IF NOT EXISTS workforce_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, version TEXT NOT NULL,
    action TEXT NOT NULL, by TEXT NOT NULL, summary TEXT NOT NULL, reason TEXT, at TEXT NOT NULL)"""


def _db() -> sqlite3.Connection:
    from avrora.api import main  # DB_PATH is patched in tests

    main.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(main.DB_PATH)
    con.execute(AUDIT_SQL)
    return con


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _day(value: str | None) -> date:
    if value is None:
        return SETTINGS.today
    try:
        d = date.fromisoformat(value)
    except ValueError:
        raise HTTPException(422, "date must be YYYY-MM-DD") from None
    days = plan_dates()
    if d not in days:
        raise HTTPException(404, f"Plans cover {days[0].isoformat()} to {days[-1].isoformat()}")
    return d


def _log(d: date, version: str, action: str, by: str, summary: str, reason: str | None = None) -> str:
    at = _now()
    with closing(_db()) as con, con:
        con.execute("INSERT INTO workforce_audit (date, version, action, by, summary, reason, at) VALUES (?,?,?,?,?,?,?)",
                    (d.isoformat(), version, action, by, summary, reason, at))
    return at


def _audit(d: date) -> list[tuple]:
    with closing(_db()) as con:
        return con.execute("SELECT version, action, by, summary, at FROM workforce_audit WHERE date = ? ORDER BY id",
                           (d.isoformat(),)).fetchall()


def _with_audit(doc: dict, rows: list[tuple], status: str = "draft") -> dict:
    return {**doc, "status": status,
            "changes": doc["changes"] + [{"at": at, "by": by, "summary": summary} for _, _, by, summary, at in rows]}


def _version(d: date, version: str) -> str:
    try:
        event_from_version(d, version)
    except EventError as e:
        raise HTTPException(422, f"Unknown plan version {version}: {e}") from None
    return version


class EventIn(BaseModel):
    kind: str
    employee_id: str | None = None
    from_: str | None = Field(default=None, alias="from")
    to: str | None = None


class ReplanIn(BaseModel):
    date: str | None = None
    event: EventIn


class ApproveIn(BaseModel):
    date: str
    version: str


class RejectIn(ApproveIn):
    reason: str = Field(min_length=1, max_length=200)


def approved_version(rows: list[tuple]) -> str | None:
    """The version the manager approved last for a day, or None (draft, or rejected since)."""
    decided = [r for r in rows if r[1] in ("approved", "rejected")]
    return decided[-1][0] if decided and decided[-1][1] == "approved" else None


@router.get("/plan")
def get_plan(date: str | None = None) -> dict:
    d = _day(date)
    rows = _audit(d)
    v = approved_version(rows)
    if v is not None:
        return _with_audit(plan_for(d, v), rows, "approved")
    return _with_audit(plan_for(d, "base"), rows)


def kpi_base() -> dict:
    """The part of /kpis that does not depend on the audit trail (precomputed into the Worker snapshot)."""
    return {"demo_data": True, "today": SETTINGS.today.isoformat(), "weeks": history_weeks(),
            "this_week": plan_week([plan_for(d, "base") for d in plan_dates()])}


@router.get("/kpis")
def kpis() -> dict:
    with closing(_db()) as con:
        rows = con.execute("SELECT action, at FROM workforce_audit ORDER BY id").fetchall()
    return {**kpi_base(), "decisions": decisions(rows, datetime.now(UTC))}


@router.post("/replan")
def post_replan(body: ReplanIn) -> dict:
    d = _day(body.date)
    e = body.event
    try:
        ev = normalise_event(d, e.kind, e.employee_id, e.from_, e.to)
    except EventError as err:
        raise HTTPException(422, str(err)) from None
    doc = replan(d, ev)
    _log(d, ev.key, "drafted", "agent", f"Replanned for {event_label(ev)}: {len(doc['diff'])} changes")
    return _with_audit(doc, _audit(d))


@router.post("/plan/approve")
def approve(body: ApproveIn) -> dict:
    d = _day(body.date)
    v = _version(d, body.version)
    at = _log(d, v, "approved", "manager", f"Manager approved plan {v}")
    return {"status": "approved", "at": at, "date": d.isoformat(), "version": v}


@router.post("/plan/reject")
def reject(body: RejectIn) -> dict:
    d = _day(body.date)
    v = _version(d, body.version)
    at = _log(d, v, "rejected", "manager", f"Manager rejected plan {v}: {body.reason}", body.reason)
    return {"status": "rejected", "at": at, "date": d.isoformat(), "version": v, "reason": body.reason}


@router.get("/employees")
def employees() -> dict:
    return employee_list()


@router.get("/employees/{employee_id}")
def employee(employee_id: str) -> dict:
    p = employee_profile(employee_id)
    if p is None:
        raise HTTPException(404, f"Unknown employee {employee_id}")
    return p
