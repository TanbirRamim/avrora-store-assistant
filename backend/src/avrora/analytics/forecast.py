"""Per-product demand forecast and stock position.

Deterministic: the same data always yields the same numbers.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

from avrora.config import SETTINGS, Settings
from avrora.data.loader import StoreData


def disrupted_days(events: pd.DataFrame) -> set[pd.Timestamp]:
    """Store-wide days whose sales are not representative (outages, alerts)."""
    mask = events["type"].isin(["power_outage", "air_raid_alert"])
    return set(events.loc[mask, "date"])


def weekday_index(sales: pd.DataFrame, skip: set[pd.Timestamp]) -> pd.Series:
    daily = sales[~sales["date"].isin(skip)].groupby("date")["units_sold"].sum()
    idx = daily.groupby(daily.index.day_of_week).mean()
    return idx / idx.mean()


def clean_sales(data: StoreData, adjust_promo: bool = False) -> pd.DataFrame:
    """Sales without disrupted or promotion days, divided by the weekday index.

    With adjust_promo the promotion days stay in, with the promotion uplift divided out instead.
    """
    skip = disrupted_days(data.events)
    promo_days = (data.events[data.events["type"] == "promotion"][["date", "product_id", "uplift"]]
                  .drop_duplicates(["date", "product_id"]).assign(promo=True))
    wk = weekday_index(data.sales, skip)
    s = data.sales.merge(promo_days, on=["date", "product_id"], how="left")
    s["promo"] = s["promo"].astype("boolean").fillna(False).astype(bool)
    s["dow_idx"] = s["date"].dt.day_of_week.map(wk)
    clean = s[~s["date"].isin(skip) & (True if adjust_promo else ~s["promo"])].copy()
    clean["deseasoned"] = clean["units_sold"] / clean["dow_idx"]
    if adjust_promo:
        clean["deseasoned"] /= clean["uplift"].where(clean["promo"], 1.0).fillna(1.0)
    return clean


def product_metrics(data: StoreData, settings: Settings = SETTINGS) -> pd.DataFrame:
    """One row per product: forecast, variability, stock, cover, reorder numbers."""
    today = pd.Timestamp(settings.today)
    clean = clean_sales(data)

    window_start = today - pd.Timedelta(days=settings.forecast_window_days)
    recent = clean[clean["date"] >= window_start]
    base = recent.groupby("product_id")["deseasoned"].agg(base_rate="mean", sd="std")
    # products promoted on every day of the window have no plain days: use the uplift-adjusted rate
    adjusted = clean_sales(data, adjust_promo=True)
    adjusted = adjusted[adjusted["date"] >= window_start].groupby("product_id")["deseasoned"].agg(base_rate="mean", sd="std")
    base = pd.concat([base, adjusted[~adjusted.index.isin(base.index)]])

    # each product's last known stock, even when it has no row on the last date
    last_stock = data.stock.sort_values("date").groupby("product_id")["stock_end"].last()

    d = data.deliveries
    open_orders = d[d["actual_date"].isna()]
    on_order = open_orders.groupby("product_id")["quantity"].sum()
    overdue = open_orders[open_orders["expected_date"] < today]

    m = data.products.set_index("product_id").join(base)
    history = m["base_rate"].notna()  # no sales history at all means unknown, not dead stock
    m = m.fillna({"base_rate": 0.0, "sd": 0.0})
    m["stock"] = last_stock.reindex(m.index)
    no_stock = m["stock"].isna()
    m["stock"] = m["stock"].fillna(0).astype(int)
    m["on_order"] = on_order.reindex(m.index).fillna(0).astype(int)
    m["overdue_qty"] = overdue.groupby("product_id")["quantity"].sum().reindex(m.index).fillna(0).astype(int)
    m["overdue_days"] = (
        overdue.assign(days=(today - overdue["expected_date"]).dt.days).groupby("product_id")["days"].max()
        .reindex(m.index).fillna(0).astype(int)
    )
    rate = m["base_rate"].replace(0, np.nan)
    m["days_cover"] = (m["stock"] / rate).fillna(np.inf)  # zero observed sales: stock never clears
    m.loc[~history | no_stock, "days_cover"] = np.nan  # unknown
    lt = m["lead_time_days"]
    m["safety_stock"] = settings.service_level_z * m["sd"] * np.sqrt(lt)
    m["reorder_point"] = m["base_rate"] * lt + m["safety_stock"]
    target = m["base_rate"] * (lt + settings.review_period_days) + m["safety_stock"]
    raw = (target - m["stock"] - m["on_order"]).clip(lower=0)
    m["order_qty"] = [
        0 if not q > 0 or unknown else int(math.ceil(q / pack) * pack)
        for q, pack, unknown in zip(raw, m["case_pack"], ~history | no_stock)
    ]
    m["stock_value"] = m["stock"] * m["price"]
    return m.reset_index()


def sales_history(data: StoreData, product_id: str, days: int = 30, settings: Settings = SETTINGS) -> pd.DataFrame:
    since = pd.Timestamp(settings.today) - pd.Timedelta(days=days)
    s = data.sales[(data.sales["product_id"] == product_id) & (data.sales["date"] >= since)]
    st = data.stock[(data.stock["product_id"] == product_id) & (data.stock["date"] >= since)]
    return s.merge(st, on=["date", "product_id"])[["date", "units_sold", "stock_end"]]
