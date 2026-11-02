"""Typed action objects shared by the engine, the AI layer and the API."""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class ActionType(str, Enum):
    ORDER = "ORDER"
    DISCOUNT = "DISCOUNT"
    MOVE_TO_FRONT = "MOVE_TO_FRONT"
    CHECK_DELIVERY = "CHECK_DELIVERY"
    EXPLAIN_ANOMALY = "EXPLAIN_ANOMALY"


class Action(BaseModel):
    id: str
    type: ActionType
    product_id: str
    product_name: str
    category: str
    risk_uah: float = Field(description="Money at stake if nothing is done, in UAH")
    facts: dict[str, float | int | str] = Field(description="The numbers behind the action")
    proposal: dict[str, float | int | str] = Field(description="Suggested quantity, discount or step")
    reason: str = Field(description="Plain-language reason; template text until the AI layer rewrites it")
