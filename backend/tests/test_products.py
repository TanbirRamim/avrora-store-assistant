import pandas as pd
import pytest
from fastapi.testclient import TestClient

from avrora.api import main
from avrora.export import compact_detail, expand_detail

STATUS = {"CHECK_DELIVERY": "late", "ORDER": "running_out", "MOVE_TO_FRONT": "hard_to_find", "DISCOUNT": "overstocked"}


@pytest.fixture(scope="module")
def client():
    return TestClient(main.app)


@pytest.fixture(scope="module")
def listing(client):
    return client.get("/api/products").json()


def test_lists_every_product(listing):
    rows = listing["products"]
    assert len(rows) == 200 and len({r["product_id"] for r in rows}) == 200
    assert listing["today"] == "2026-11-02" and listing["last_day"] == "2026-11-01"


def test_status_matches_actions_engine(listing):
    actions = main._plan().actions
    by_product = {}
    for a in actions:
        by_product.setdefault(a.product_id, []).append(a)
    rows = {r["product_id"]: r for r in listing["products"]}
    for pid, acts in by_product.items():
        assert rows[pid]["status"] in {STATUS[a.type.value] for a in acts}
        assert {x["id"] for x in rows[pid]["actions"]} == {a.id for a in acts}
    for pid, r in rows.items():
        if pid not in by_product:
            assert r["status"] in {"low", "on_order", "ok"} and r["actions"] == []
    # the same counts Today shows
    o = main.overview()
    count = lambda s: sum(r["status"] == s for r in rows.values())
    assert count("running_out") == o.stockout_risks
    assert count("late") == o.late_deliveries
    assert count("hard_to_find") == o.visibility_issues


def test_needs_attention_first(listing):
    flags = [r["attention"] for r in listing["products"]]
    assert flags == sorted(flags, reverse=True)
    with_actions = [r for r in listing["products"] if r["actions"]]
    assert listing["products"][: len(with_actions)] == with_actions
    risks = [sum(a["risk_uah"] for a in r["actions"]) for r in with_actions]
    assert risks == sorted(risks, reverse=True)


def test_numbers_agree_with_metrics_and_data(listing):
    m = main._plan().metrics.set_index("product_id")
    data = main._data()
    last = data.stock["date"].max()
    for r in listing["products"]:
        mr = m.loc[r["product_id"]]
        assert r["stock"] == int(mr.stock) and r["on_order"] == int(mr.on_order)
        assert r["daily_sales"] == round(float(mr.base_rate), 1)
        if r["days_cover"] is not None:
            assert r["days_cover"] == round(float(mr.days_cover), 1)
        # stock moves only by sales and deliveries
        assert r["stock_change_7d"] == r["received_7d"] - r["sold_7d"]
        s = data.sales[(data.sales["product_id"] == r["product_id"]) & (data.sales["date"] > last - pd.Timedelta(days=7))]
        assert r["sold_7d"] == int(s["units_sold"].sum())
        if r["status"] == "late":
            assert r["next_delivery"]["late"]


def test_low_and_on_order_are_below_reorder_point(listing):
    m = main._plan().metrics.set_index("product_id")
    for r in listing["products"]:
        mr = m.loc[r["product_id"]]
        below = mr.base_rate > 0 and mr.stock <= mr.reorder_point
        if r["status"] == "low":
            assert below and r["on_order"] == 0
        if r["status"] == "on_order":
            assert below and r["on_order"] > 0


def test_detail_keeps_old_shape_and_adds_facts(client, listing):
    top = listing["products"][0]
    d = client.get(f"/api/products/{top['product_id']}").json()
    for k in ("product_id", "name", "category", "price", "supplier", "lead_time_days", "daily_forecast",
              "days_cover", "history"):
        assert k in d
    assert d["status"] == top["status"] and d["actions"] == top["actions"]
    assert d["updates"][0]["kind"] == "suggestion"
    assert [u["date"] for u in d["updates"]] == sorted((u["date"] for u in d["updates"]), reverse=True)


def test_late_delivery_wording(client):
    late = next(a for a in main._plan().actions if a.type.value == "CHECK_DELIVERY")
    d = client.get(f"/api/products/{late.product_id}").json()
    line = next(u for u in d["updates"] if u["kind"] == "late")
    assert f"{int(late.facts['overdue_days'])} days late" in line["text"]
    assert line["text"].startswith(f"{int(late.facts['overdue_qty'])} units")


def test_store_feed(listing):
    feed = listing["updates"]
    names = {r["product_id"]: r["name"] for r in listing["products"]}
    assert feed and all(names[u["product_id"]] == u["name"] for u in feed)
    assert {u["kind"] for u in feed} <= {"late", "expected", "received", "sold_out", "no_sales"}
    assert sum(u["kind"] == "late" for u in feed) == main.overview().late_deliveries


def test_unknown_product(client):
    assert client.get("/api/products/NOPE").status_code == 404


def test_snapshot_compaction_round_trips(client, listing):
    for row in listing["products"][:20]:
        full = client.get(f"/api/products/{row['product_id']}").json()
        assert expand_detail(row, compact_detail(full)) == full
