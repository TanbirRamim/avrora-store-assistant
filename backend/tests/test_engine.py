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
