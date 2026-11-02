"""Score the engine against the planted problems in ``answer_key.csv``."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from avrora.actions.engine import Plan
from avrora.config import SETTINGS


@dataclass
class Score:
    planted: int
    found: int
    raised: int
    correct: int
    missed: list[str]
    extra: list[str]

    @property
    def recall(self) -> float:
        return self.found / self.planted if self.planted else 0.0

    @property
    def precision(self) -> float:
        return self.correct / self.raised if self.raised else 0.0


def evaluate(plan: Plan, data_dir: Path | None = None) -> Score:
    key = pd.read_csv(Path(data_dir or SETTINGS.data_dir) / "answer_key.csv")
    expected = set(zip(key["product_id"], key["expected_action"]))
    raised = {(a.product_id, a.type.value) for a in plan.actions + plan.notices}
    hits = expected & raised
    return Score(
        planted=len(expected),
        found=len(hits),
        raised=len(raised),
        correct=len(hits),
        missed=sorted(f"{p}:{t}" for p, t in expected - raised),
        extra=sorted(f"{p}:{t}" for p, t in raised - expected),
    )
