"""Write the read-only API responses to one JSON file for the Cloudflare deployment.

The store data is synthetic and fixed, so every GET route can be computed once at build
time. Only decisions change at runtime; the Worker keeps those in D1.
"""

from __future__ import annotations

import json
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path

from fastapi.testclient import TestClient

from avrora.analytics.purchases import order_row
from avrora.api import main as api_main
from avrora.api.main import app
from avrora.api.workforce import _replan_limiter as replan_limit
from avrora.api.workforce import kpi_base
from avrora.workforce.people import employee_list, employee_profile
from avrora.workforce.plan import all_events, base_plan, plan_dates, replan

# Product detail fields that the list row already carries; the Worker copies them back.
FROM_ROW = ("product_id", "name", "category", "price", "supplier", "days_cover", "status", "stock", "on_order",
            "next_delivery", "sold_7d", "received_7d", "stock_change_7d", "last_sale", "actions")


def compact_detail(detail: dict) -> dict:
    """A product detail without the list row's fields and with the history as plain arrays.

    The history is consecutive days of actual sales and stock, then forecast days that all
    carry the same value. ``expand_detail`` (and the Worker) rebuild the API response exactly.
    """
    hist = detail["history"]
    actual = [p for p in hist if p["forecast"] is None]
    ahead = [p for p in hist if p["forecast"] is not None]
    out = {k: v for k, v in detail.items() if k not in FROM_ROW and k not in ("history", "purchases", "purchase_summary")}
    out["h"] = {"start": hist[0]["date"] if hist else None,
                "sold": [p["units_sold"] for p in actual], "stock": [p["stock_end"] for p in actual],
                "ahead": len(ahead), "ahead_start": ahead[0]["date"] if ahead else None}
    # purchases as [delivery number, ordered, days to expected, days to received or null, qty];
    # status and days_late follow from the dates and today
    gap = lambda a, b: (date.fromisoformat(b) - date.fromisoformat(a)).days
    out["p"] = [[int(o["id"][1:]), o["ordered"], gap(o["ordered"], o["expected"]),
                 None if o["received"] is None else gap(o["ordered"], o["received"]), o["qty"]]
                for o in detail.get("purchases", [])]
    # the summary's two averages; counts, units and last received follow from the rows
    ps = detail.get("purchase_summary") or {}
    out["ps"] = [ps.get("avg_lead_days"), ps.get("on_time_pct")]
    return out


def _days(start: str | None, n: int) -> list[str]:
    if start is None:
        return []
    d0 = date.fromisoformat(start)
    return [(d0 + timedelta(days=i)).isoformat() for i in range(n)]


def _purchases(rows: list, today: date) -> list[dict]:
    """The inverse of the ``p`` arrays in ``compact_detail`` (the Worker does the same)."""
    out = []
    for n, ordered, to_expected, to_received, qty in rows:
        o = date.fromisoformat(ordered)
        received = None if to_received is None else o + timedelta(days=to_received)
        out.append(order_row(f"D{n:05d}", o, o + timedelta(days=to_expected), received, qty, today))
    return out


def expand_detail(row: dict, compact: dict, today: str) -> dict:
    h = compact["h"]
    history = [{"date": d, "units_sold": u, "stock_end": s, "forecast": None}
               for d, u, s in zip(_days(h["start"], len(h["sold"])), h["sold"], h["stock"])]
    history += [{"date": d, "units_sold": None, "stock_end": None, "forecast": compact["daily_forecast"]}
                for d in _days(h["ahead_start"], h["ahead"])]
    rest = {k: v for k, v in compact.items() if k not in ("h", "p", "ps")}
    purchases = _purchases(compact["p"], date.fromisoformat(today))
    received = [o["received"] for o in purchases if o["received"] is not None]
    summary = {"orders": len(purchases), "units": sum(o["qty"] for o in purchases),
               "avg_lead_days": compact["ps"][0], "on_time_pct": compact["ps"][1],
               "last_received": max(received, default=None)}
    return {**{k: row[k] for k in FROM_ROW}, **rest, "history": history,
            "purchases": purchases, "purchase_summary": summary}


# --------------------------------------------------------------------------- workforce
# Plans for today..+6 and every replan the planner offers (sick x employee, and air_alert /
# power / traffic_spike x start hour) are precomputed: the scheduler stays in one place
# (Python) and the Worker serves byte-identical documents. A replan is stored as the keys
# that differ from the day's base plan; inside it, hours equal to the base are null and
# shifts equal to a base shift are that shift's index. Status and changes come from the
# audit table at request time, as in the API.


def compact_replan(base: dict, doc: dict) -> dict:
    out = {k: v for k, v in doc.items() if k not in base or base[k] != v}
    if "hours" in out:
        out["hours"] = [None if h == b else h for h, b in zip(out["hours"], base["hours"], strict=True)]
    if "shifts" in out:
        out["shifts"] = [base["shifts"].index(s) if s in base["shifts"] else s for s in out["shifts"]]
    return out


def expand_replan(base: dict, compact: dict) -> dict:
    out = {**base, **compact}
    if "hours" in compact:
        out["hours"] = [b if h is None else h for h, b in zip(compact["hours"], base["hours"], strict=True)]
    if "shifts" in compact:
        out["shifts"] = [base["shifts"][s] if isinstance(s, int) else s for s in compact["shifts"]]
    return out


PROFILE_FROM_ROW = ("employee_id", "name", "role", "skills", "contract_hours_week", "hours_this_week",
                    "status_today", "next_shift", "score", "trend", "strength")


def workforce_snapshot() -> dict:
    plans, replans = {}, {}
    for d in plan_dates():
        base = base_plan(d)
        plans[d.isoformat()] = base
        replans[d.isoformat()] = {e.key: compact_replan(base, replan(d, e)) for e in all_events(d)}
    rows = employee_list()
    profiles = {r["employee_id"]: {k: v for k, v in employee_profile(r["employee_id"]).items() if k not in PROFILE_FROM_ROW}
                for r in rows["employees"]}
    return {"plans": plans, "replans": replans, "employees": rows, "profiles": profiles, "kpis": kpi_base()}


def verify_workforce(client: TestClient, wf: dict) -> None:
    """Every workforce response the Worker can give, rebuilt from the snapshot, equals the API's."""
    strip = lambda doc: {k: v for k, v in doc.items() if k not in ("changes", "status")}
    get = lambda path: client.get(path).raise_for_status().json()
    for day, base in wf["plans"].items():
        assert strip(get(f"/api/workforce/plan?date={day}")) == strip(base), day
        for key, compact in wf["replans"][day].items():
            kind, _, arg = key.rpartition("-")
            event = {"kind": kind, "employee_id": arg} if kind == "sick" else {"kind": kind, "from": f"{arg}:00"}
            got = client.post("/api/workforce/replan", json={"date": day, "event": event}).raise_for_status().json()
            assert strip(got) == strip(expand_replan(base, compact)), (day, key)
    assert get("/api/workforce/employees") == wf["employees"]
    assert {k: v for k, v in get("/api/workforce/kpis").items() if k != "decisions"} == wf["kpis"]
    for r in wf["employees"]["employees"]:
        full = get(f"/api/workforce/employees/{r['employee_id']}")
        assert full == {**{k: r[k] for k in PROFILE_FROM_ROW}, **wf["profiles"][r["employee_id"]]}, r["employee_id"]


def main(out: Path) -> None:
    replan_limit.hits.clear()
    replan_limit.per_window = 10**9  # the export replays every replan once; the per-client cap is for browsers
    client = TestClient(app)
    get = lambda path: client.get(path).raise_for_status().json()
    product_list = get("/api/products")
    details = {}
    for row in product_list["products"]:
        full = get(f"/api/products/{row['product_id']}")
        details[row["product_id"]] = compact_detail(full)
        assert expand_detail(row, details[row["product_id"]], product_list["today"]) == full, row["product_id"]
    snapshot = {
        "overview": get("/api/overview"),
        "briefing": get("/api/briefing"),
        "actions": get("/api/actions"),
        "evaluation": get("/api/evaluation"),
        "product_list": product_list,
        "product_details": details,
        "workforce": workforce_snapshot(),
    }
    with tempfile.TemporaryDirectory() as tmp:  # replans write audit rows; keep them out of the real database
        real, api_main.DB_PATH = api_main.DB_PATH, Path(tmp) / "verify.sqlite"
        try:
            verify_workforce(client, snapshot["workforce"])
        finally:
            api_main.DB_PATH = real
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")))
    print(f"Wrote {out} ({out.stat().st_size // 1024} KB, {len(details)} products, "
          f"{sum(len(r) for r in snapshot['workforce']['replans'].values())} workforce replans)")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
