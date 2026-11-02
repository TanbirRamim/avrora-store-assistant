"""Central settings for the store assistant."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"


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

    # Output
    top_n: int = 5
    currency: str = "UAH"
    data_dir: Path = field(default=DATA_DIR)


SETTINGS = Settings()
