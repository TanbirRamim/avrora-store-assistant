"""Generative layer: choose today's priorities and explain them.

The model receives only actions the engine already computed. It may pick
and order them and rewrite their reasons in plain language. Its output is
validated: unknown action ids are dropped and any reason that mentions a
number not present in that action's facts is replaced by the engine's
template text. If no model is configured or the call fails, the briefing
falls back to the deterministic ranking.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Protocol

from pydantic import BaseModel, Field

from avrora.actions.models import Action

log = logging.getLogger(__name__)

CANDIDATES = 12

SYSTEM_PROMPT = """You help the manager of a small discount store plan their day.
You receive candidate actions computed from the store's data. Each has an id, a type, the numbers behind it
and an estimated amount of money at stake in UAH.

Choose the five actions the manager should handle today and order them by urgency. Money at stake matters most,
but an item that will run out before a delivery can arrive is more urgent than slow stock that can wait a few
days. Write one short reason per action for a busy store manager: at most 25 words, plain language, no jargon.
Use only numbers that appear in that action's data. Write a one-sentence summary of the day.
Return exactly the JSON requested."""


class Pick(BaseModel):
    action_id: str
    reason: str = Field(description="At most 25 words, numbers only from the action's data")


class BriefingDraft(BaseModel):
    summary: str
    priorities: list[Pick]


class Briefing(BaseModel):
    summary: str
    priorities: list[Action]
    source: str = Field(description="'model' when the AI wrote it, 'rules' for the deterministic fallback")


class Drafter(Protocol):
    def __call__(self, payload: str) -> BriefingDraft: ...


# --------------------------------------------------------------------------- providers


def ollama_drafter() -> Drafter | None:
    """Self-hosted open model through Ollama, e.g. the OTH KIGS GPU server."""
    host = os.getenv("OLLAMA_HOST")
    if not host:
        return None
    import httpx

    model = os.getenv("OLLAMA_MODEL", "qwen3:32b")
    key = os.getenv("OLLAMA_API_KEY")  # needed when Ollama sits behind Open WebUI
    headers = {"Authorization": f"Bearer {key}"} if key else {}

    def draft(payload: str) -> BriefingDraft:
        r = httpx.post(f"{host.rstrip('/')}/api/chat", timeout=180, headers=headers, json={
            "model": model, "stream": False, "think": False, "format": BriefingDraft.model_json_schema(),
            "options": {"temperature": 0},
            "messages": [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": payload}],
        })
        r.raise_for_status()
        return BriefingDraft.model_validate_json(r.json()["message"]["content"])

    return draft


def default_drafter() -> Drafter | None:
    if os.getenv("AVRORA_LLM", "ollama").lower() == "none":
        return None
    return ollama_drafter()


# --------------------------------------------------------------------------- validation

_NUM = re.compile(r"\d+(?:[.,]\d+)?")


def _allowed_numbers(a: Action) -> set[float]:
    nums: set[float] = set()
    for v in list(a.facts.values()) + list(a.proposal.values()) + [a.risk_uah]:
        for m in _NUM.findall(str(v)):
            x = float(m.replace(",", "."))
            nums |= {x, round(x), round(x, 1)}
    return nums


def reason_is_grounded(reason: str, action: Action) -> bool:
    allowed = _allowed_numbers(action)
    for m in _NUM.findall(reason.replace(" ", "").replace(" ", "")):
        x = float(m.replace(",", "."))
        if x not in allowed and round(x) not in allowed and not (x <= 7 and x == int(x)):
            return False  # small whole numbers (e.g. "2 cases", "5 items") are allowed
    return len(reason.split()) <= 40


def _payload(cands: list[Action], notices: list[Action]) -> str:
    rows = [{"id": a.id, "type": a.type.value, "product": a.product_name, "risk_uah": a.risk_uah,
             "facts": a.facts, "proposal": a.proposal} for a in cands]
    notes = [n.reason for n in notices]
    return json.dumps({"candidates": rows, "store_notes": notes}, ensure_ascii=False)


def _fallback_summary(top: list[Action]) -> str:
    total = sum(a.risk_uah for a in top)
    return f"{len(top)} priorities today, about ₴{total:,.0f} at stake."


def build_briefing(actions: list[Action], notices: list[Action], top_n: int = 5,
                   drafter: Drafter | None = None, use_default: bool = True) -> Briefing:
    cands = actions[:CANDIDATES]
    rules = Briefing(summary=_fallback_summary(cands[:top_n]), priorities=cands[:top_n], source="rules")
    drafter = drafter or (default_drafter() if use_default else None)
    if drafter is None or not cands:
        return rules
    try:
        draft = drafter(_payload(cands, notices))
    except Exception as exc:  # noqa: BLE001 - any model failure must degrade to the rules briefing
        log.warning("briefing model failed, using rules: %s", exc)
        return rules

    by_id = {a.id: a for a in cands}
    chosen: list[Action] = []
    for p in draft.priorities:
        a = by_id.get(p.action_id)
        if a is None or a in chosen:
            continue
        reason = p.reason.strip() if reason_is_grounded(p.reason, a) else a.reason
        chosen.append(a.model_copy(update={"reason": reason}))
        if len(chosen) == top_n:
            break
    for a in cands:  # top up from the ranking if the model returned too few
        if len(chosen) == top_n:
            break
        if all(c.id != a.id for c in chosen):
            chosen.append(a)
    summary = draft.summary.strip()
    merged = Action(**{**chosen[0].model_dump(), "facts": {
        f"{c.id}.{k}": v for c in chosen for k, v in {**c.facts, **c.proposal, "risk": c.risk_uah}.items()}})
    if not summary or not reason_is_grounded(summary, merged):
        summary = _fallback_summary(chosen)
    return Briefing(summary=summary, priorities=chosen, source="model")
