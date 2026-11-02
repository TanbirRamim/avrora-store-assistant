import pytest

from avrora.actions.engine import build_plan
from avrora.ai.briefing import BriefingDraft, Pick, build_briefing, reason_is_grounded
from avrora.data.generate import generate
from avrora.data.loader import load


@pytest.fixture(scope="module")
def plan(tmp_path_factory):
    return build_plan(load(generate(out_dir=tmp_path_factory.mktemp("d"))))


def test_rules_fallback_without_model(plan):
    b = build_briefing(plan.actions, plan.notices, use_default=False)
    assert b.source == "rules"
    assert [a.id for a in b.priorities] == [a.id for a in plan.actions[:5]]


def test_model_can_reorder_and_rewrite(plan):
    a, c = plan.actions[0], plan.actions[3]
    days = c.facts.get("days_cover", c.facts.get("drop_pct"))

    def drafter(_payload):
        return BriefingDraft(summary="Two urgent items today.", priorities=[
            Pick(action_id=c.id, reason=f"Will be gone in {days} days, act now."),
            Pick(action_id=a.id, reason="Handle this one next."),
        ])

    b = build_briefing(plan.actions, plan.notices, drafter=drafter)
    assert b.source == "model"
    assert b.priorities[0].id == c.id
    assert b.priorities[0].reason.startswith("Will be gone")
    assert len(b.priorities) == 5


def test_invented_numbers_are_rejected(plan):
    a = plan.actions[0]

    def drafter(_payload):
        return BriefingDraft(summary="We will save 987654 UAH.", priorities=[
            Pick(action_id=a.id, reason="Order 4321 units right now."),
            Pick(action_id="ORDER-P999", reason="Not a real action."),
        ])

    b = build_briefing(plan.actions, plan.notices, drafter=drafter)
    assert b.priorities[0].reason == a.reason  # template restored
    assert all(p.id != "ORDER-P999" for p in b.priorities)
    assert "987654" not in b.summary


def test_model_failure_falls_back(plan):
    def drafter(_payload):
        raise TimeoutError("network down")

    assert build_briefing(plan.actions, plan.notices, drafter=drafter).source == "rules"


def test_grounding_accepts_rounded_values(plan):
    a = next(x for x in plan.actions if x.type.value == "ORDER")
    assert reason_is_grounded(f"Only {a.facts['stock']} left; order {a.proposal['order_qty']}.", a)
