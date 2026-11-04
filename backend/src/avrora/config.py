"""Central settings for the store assistant."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"


def _csv(name: str, default: tuple[str, ...]) -> tuple[str, ...]:
    items = tuple(x.strip() for x in os.getenv(name, "").split(",") if x.strip())
    return items or default


@dataclass(frozen=True)
class Settings:
    store_id: str = "417"
    store_name: str = "Avrora Store #417, Vinnytsia"
    today: date = date(2026, 11, 2)
    history_days: int = 90
    seed: int = 417

    # Forecasting
    forecast_window_days: int = 28
    service_level_z: float = 1.65  # ~95% cycle service level
    review_period_days: int = 7  # an order should cover lead time + one week

    # Detection thresholds
    overstock_cover_days: float = 90.0
    target_cover_days: float = 30.0
    visibility_drop_ratio: float = 0.4
    visibility_min_baseline: float = 1.5
    anomaly_drop_ratio: float = 0.3

    # HTTP surface (read when the settings are created; see backend/.env.example)
    allowed_hosts: tuple[str, ...] = field(
        default_factory=lambda: _csv("AVRORA_ALLOWED_HOSTS", ("localhost", "127.0.0.1", "testserver")))
    cors_origins: tuple[str, ...] = field(
        default_factory=lambda: _csv("AVRORA_CORS_ORIGINS", ("http://localhost:3000", "http://127.0.0.1:3000")))
    # Header that carries the client address behind a reverse proxy (e.g. CF-Connecting-IP); empty = socket peer.
    # Only set it when the proxy overwrites that header, otherwise clients can spoof it.
    client_ip_header: str = field(default_factory=lambda: os.getenv("AVRORA_CLIENT_IP_HEADER", "").strip())

    # Output
    top_n: int = 5
    currency: str = "UAH"
    data_dir: Path = field(default=DATA_DIR)


SETTINGS = Settings()


@dataclass(frozen=True)
class LabourRules:
    """Hard rules every staffing plan must keep (synthetic store, Ukrainian labour code in spirit)."""

    open_hour: int = 8
    close_hour: int = 21
    max_shift_hours: int = 8  # shift length from start to end, break included
    min_shift_hours: int = 4  # planning rule for new shifts, not a legal limit
    max_week_hours: float = 40.0  # also capped by each contract
    min_rest_hours: int = 11
    break_after_hours: int = 6  # shifts longer than this get a 30-minute break
    break_minutes: int = 30
    min_on_site: int = 2
    lead_roles: tuple[str, ...] = ("shift_lead", "senior_cashier")
    utilisation: float = 0.85


RULES = LabourRules()
