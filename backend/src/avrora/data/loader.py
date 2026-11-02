"""Load the store dataset into typed DataFrames."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from avrora.config import SETTINGS


@dataclass(frozen=True)
class StoreData:
    products: pd.DataFrame
    sales: pd.DataFrame
    stock: pd.DataFrame
    deliveries: pd.DataFrame
    events: pd.DataFrame


def load(data_dir: Path | None = None) -> StoreData:
    d = Path(data_dir or SETTINGS.data_dir)
    if not (d / "products.csv").exists():
        from avrora.data.generate import generate

        generate(out_dir=d)
    dates = {"parse_dates": ["date"]}
    return StoreData(
        products=pd.read_csv(d / "products.csv"),
        sales=pd.read_csv(d / "sales.csv", **dates),
        stock=pd.read_csv(d / "stock.csv", **dates),
        deliveries=pd.read_csv(d / "deliveries.csv", parse_dates=["ordered_date", "expected_date", "actual_date"]),
        events=pd.read_csv(d / "events.csv", **dates).fillna({"product_id": ""}),
    )
