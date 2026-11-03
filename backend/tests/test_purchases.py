from datetime import date

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from avrora.analytics.purchases import order_row, summarize
from avrora.api import main

TODAY = date(2026, 11, 2)


@pytest.fixture(scope="module")
def details():
    client = TestClient(main.app)
    rows = client.get("/api/products").json()["products"]
    return rows, {r["product_id"]: client.get(f"/api/products/{r['product_id']}").json() for r in rows}


def test_status_rules():
    d = date.fromisoformat
    assert order_row("D1", d("2026-10-01"), d("2026-10-05"), d("2026-10-05"), 10, TODAY)["status"] == "received"
    early = order_row("D1", d("2026-10-01"), d("2026-10-05"), d("2026-10-04"), 10, TODAY)
    assert (early["status"], early["days_late"]) == ("received", 0)
    slow = order_row("D1", d("2026-10-01"), d("2026-10-05"), d("2026-10-08"), 10, TODAY)
    assert (slow["status"], slow["days_late"], slow["received"]) == ("late", 3, "2026-10-08")
    out = order_row("D1", d("2026-10-25"), d("2026-10-29"), None, 10, TODAY)
    assert (out["status"], out["days_late"], out["received"]) == ("late", 4, None)
    # due today is not late yet
    assert order_row("D1", d("2026-10-30"), TODAY, None, 10, TODAY)["status"] == "on_the_way"


def test_summary_counts_only_due_orders_for_on_time():
    d = date.fromisoformat
    rows = [order_row("D3", d("2026-10-30"), d("2026-11-04"), None, 5, TODAY),
            order_row("D2", d("2026-10-01"), d("2026-10-05"), d("2026-10-08"), 10, TODAY),
            order_row("D1", d("2026-09-01"), d("2026-09-05"), d("2026-09-05"), 20, TODAY)]
    assert summarize(rows) == {"orders": 3, "units": 35, "avg_lead_days": 5.5, "on_time_pct": 50,
                               "last_received": "2026-10-08"}
    assert summarize([]) == {"orders": 0, "units": 0, "avg_lead_days": None, "on_time_pct": None,
                             "last_received": None}


def test_every_delivery_appears_once_newest_first(details):
    _, by_id = details
    deliveries = main._data().deliveries
    seen = [o["id"] for p in by_id.values() for o in p["purchases"]]
    assert sorted(seen) == sorted(deliveries["delivery_id"]) and len(seen) == 839
    for p in by_id.values():
        ordered = [(o["ordered"], o["id"]) for o in p["purchases"]]
        assert ordered == sorted(ordered, reverse=True)
        s = p["purchase_summary"]
        assert s["orders"] == len(p["purchases"]) and s["units"] == sum(o["qty"] for o in p["purchases"])


def test_consistent_with_stock_facts(details):
    rows, by_id = details
    week_ago = (pd.Timestamp(main.SETTINGS.today) - pd.Timedelta(days=8)).date().isoformat()
    for r in rows:
        p = by_id[r["product_id"]]["purchases"]
        assert r["on_order"] == sum(o["qty"] for o in p if o["received"] is None)
        assert r["received_7d"] == sum(o["qty"] for o in p if o["received"] and o["received"] > week_ago)
        out = sorted((o for o in p if o["received"] is None), key=lambda o: o["expected"])
        nd = r["next_delivery"]
        if out:
            assert nd == {"date": out[0]["expected"], "qty": out[0]["qty"], "late": out[0]["status"] == "late"}
        else:
            assert nd is None
    late = [o for p in by_id.values() for o in p["purchases"] if o["status"] == "late"]
    assert {o["id"] for o in late} == {"D00759", "D00766"}
    assert all(o["received"] is None and o["days_late"] > 0 for o in late)
