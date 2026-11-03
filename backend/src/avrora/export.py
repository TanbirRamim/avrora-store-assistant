"""Write the read-only API responses to one JSON file for the Cloudflare deployment.

The store data is synthetic and fixed, so every GET route can be computed once at build
time. Only decisions change at runtime; the Worker keeps those in D1.
"""

from __future__ import annotations

import json
import sys
from datetime import date, timedelta
from pathlib import Path

from fastapi.testclient import TestClient

from avrora.analytics.purchases import order_row
from avrora.api.main import app

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


def main(out: Path) -> None:
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
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")))
    print(f"Wrote {out} ({out.stat().st_size // 1024} KB, {len(details)} products)")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
