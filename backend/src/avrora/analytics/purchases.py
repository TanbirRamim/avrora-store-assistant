"""Purchase history per product: every supplier order in the data, newest first.

There is no purchase cost in the data, so this is about dates and quantities only.
An order is late when it was due before today and has not arrived, or when it arrived
after its expected date. ``days_late`` counts whole days past the expected date
(up to today for orders still out).
"""

from __future__ import annotations

from datetime import date

import pandas as pd

from avrora.config import SETTINGS, Settings


def _status(expected: date, received: date | None, today: date) -> tuple[str, int]:
    if received is None:
        late = (today - expected).days if expected < today else 0
        return ("late" if late > 0 else "on_the_way"), late
    late = max(0, (received - expected).days)
    return ("late" if late > 0 else "received"), late


def order_row(delivery_id: str, ordered: date, expected: date, received: date | None, qty: int, today: date) -> dict:
    status, late = _status(expected, received, today)
    return {"id": delivery_id, "ordered": ordered.isoformat(), "expected": expected.isoformat(),
            "received": None if received is None else received.isoformat(), "qty": qty,
            "status": status, "days_late": late}


def summarize(rows: list[dict]) -> dict:
    """Totals for the rows of one product. On time counts only orders that are due by now."""
    got = [r for r in rows if r["received"] is not None]
    due = [r for r in rows if r["received"] is not None or r["status"] == "late"]
    lead = [(date.fromisoformat(r["received"]) - date.fromisoformat(r["ordered"])).days for r in got]
    return {
        "orders": len(rows),
        "units": sum(r["qty"] for r in rows),
        "avg_lead_days": round(sum(lead) / len(lead), 1) if lead else None,
        "on_time_pct": round(100 * sum(r["days_late"] == 0 for r in due) / len(due)) if due else None,
        "last_received": max((r["received"] for r in got), default=None),
    }


def purchase_history(deliveries: pd.DataFrame, product_id: str, settings: Settings = SETTINGS) -> dict:
    today = settings.today
    d = deliveries[deliveries["product_id"] == product_id]
    rows = [order_row(o.delivery_id, o.ordered_date.date(), o.expected_date.date(),
                      None if pd.isna(o.actual_date) else o.actual_date.date(), int(o.quantity), today)
            for o in d.itertuples(index=False)]
    rows.sort(key=lambda r: (r["ordered"], r["id"]), reverse=True)
    return {"purchases": rows, "purchase_summary": summarize(rows)}
