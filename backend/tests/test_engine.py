from pathlib import Path

import pandas as pd
import pytest

from avrora.actions.engine import build_plan
from avrora.actions.models import ActionType
from avrora.data.generate import generate
from avrora.data.loader import load
from avrora.evaluation import evaluate


@pytest.fixture(scope="module")
def data_dir(tmp_path_factory) -> Path:
    return generate(out_dir=tmp_path_factory.mktemp("data"))


@pytest.fixture(scope="module")
def plan(data_dir):
    return build_plan(load(data_dir))


def test_dataset_is_deterministic(data_dir, tmp_path):
    again = generate(out_dir=tmp_path)
    for name in ["products.csv", "sales.csv", "stock.csv", "deliveries.csv", "events.csv", "answer_key.csv"]:
        assert (data_dir / name).read_bytes() == (again / name).read_bytes(), name


def test_stock_never_negative(data_dir):
    assert (pd.read_csv(data_dir / "stock.csv")["stock_end"] >= 0).all()


def test_all_planted_problems_found(plan, data_dir):
    score = evaluate(plan, data_dir)
    assert score.missed == []
    assert score.recall == 1.0


def test_no_false_alarms(plan, data_dir):
    assert evaluate(plan, data_dir).extra == []


def test_actions_sorted_by_risk(plan):
    risks = [a.risk_uah for a in plan.actions]
    assert risks == sorted(risks, reverse=True)


def test_order_quantities_are_whole_cases(plan):
    packs = plan.metrics.set_index("product_id")["case_pack"]
    for a in plan.actions:
        if a.type is ActionType.ORDER:
            assert a.proposal["order_qty"] % packs[a.product_id] == 0


def test_outage_drop_is_explained_not_actioned(plan):
    assert any(n.facts["cause"] == "power_outage" and n.proposal["step"] == "No action" for n in plan.notices)


def _with(data, **kw):
    import dataclasses
    return dataclasses.replace(data, **kw)


def test_product_without_stock_row_on_last_date(data_dir):
    import math

    from avrora.analytics.forecast import product_metrics
    from avrora.analytics.products import build_products
    d = load(data_dir)
    pid = d.products["product_id"].iloc[0]
    last = d.stock["date"].max()
    d2 = _with(d, stock=d.stock[~((d.stock["product_id"] == pid) & (d.stock["date"] == last))])
    m = product_metrics(d2).set_index("product_id")
    assert not math.isnan(m.at[pid, "stock"])
    p = build_plan(d2)
    build_products(d2, p)
    # a product with no stock rows at all must not break anything either
    d3 = _with(d, stock=d.stock[d.stock["product_id"] != pid])
    m3 = product_metrics(d3).set_index("product_id")
    assert math.isnan(m3.at[pid, "days_cover"]) and m3.at[pid, "order_qty"] == 0
    build_products(d3, build_plan(d3))


def test_promoted_all_window_is_not_dead_stock(data_dir):
    from avrora.analytics.forecast import product_metrics
    d = load(data_dir)
    promoted = set(d.events[d.events["type"] == "promotion"]["product_id"])
    pid = next(p for p in d.products["product_id"] if p not in promoted and (d.sales["product_id"] == p).any())
    days = pd.date_range("2026-10-05", "2026-11-01")
    add = pd.DataFrame({"date": days, "type": "promotion", "product_id": pid, "hours": 0, "uplift": 1.7})
    d2 = _with(d, events=pd.concat([d.events, add], ignore_index=True))
    before = product_metrics(d).set_index("product_id").at[pid, "base_rate"]
    after = product_metrics(d2).set_index("product_id").at[pid, "base_rate"]
    assert after > 0 and abs(after - before / 1.7) < 0.35 * before
    reasons = [a.reason for a in build_plan(d2).actions if a.product_id == pid]
    assert not any("only 0.0" in r or "fell 100%" in r for r in reasons)
