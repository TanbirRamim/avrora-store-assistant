"""Synthetic dataset for one imaginary Avrora store.

The data is fictional. It mimics a low-price non-food multimarket: six
categories, weekly rhythm, promotions, power outages and air-raid alerts.
A fixed seed makes every run identical.

A small set of known problems is planted on purpose and written to
``answer_key.csv`` so the detection quality can be measured.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from avrora.config import SETTINGS, Settings

CATEGORIES: dict[str, dict] = {
    "Household": {
        "price": (20, 150),
        "suppliers": ["PolyHome LLC", "Dnipro Plast"],
        "items": ["Storage box", "Laundry basket", "Clothes hangers", "Sponge set", "Trash bags",
                  "Microfiber cloths", "Shoe rack", "Vacuum bags", "Drying rack", "Bath mat"],
        "variants": ["S", "M", "L", "20L", "Grey", "White"],
    },
    "Kitchen": {
        "price": (30, 200),
        "suppliers": ["KitchenLine", "Dnipro Plast"],
        "items": ["Food container", "Ceramic mug", "Chef knife", "Cutting board", "Glass jar",
                  "Frying pan", "Baking tray", "Tea towel", "Water bottle", "Spice rack"],
        "variants": ["0.5L", "1L", "Set of 3", "Blue", "Black", "Classic"],
    },
    "Cosmetics": {
        "price": (25, 120),
        "suppliers": ["BeautyTrade UA", "FreshCare"],
        "items": ["Shampoo", "Shower gel", "Hand soap", "Toothpaste", "Hand cream",
                  "Deodorant", "Cotton pads", "Face wipes", "Hair conditioner", "Lip balm"],
        "variants": ["Herbal", "Mint", "Sensitive", "Family", "Travel", "Classic"],
    },
    "Toys": {
        "price": (40, 250),
        "suppliers": ["PlayWay", "KidsMarket"],
        "items": ["Toy car", "Puzzle", "Soft ball", "Building blocks", "Doll",
                  "Coloring set", "Bubble wand", "Toy kitchen set", "Water gun", "Board game"],
        "variants": ["Mini", "Large", "Red", "100 pcs", "Deluxe", "Classic"],
    },
    "Stationery": {
        "price": (10, 80),
        "suppliers": ["PaperPro", "KidsMarket"],
        "items": ["Notebook", "Gel pen", "Pencil set", "Sticky notes", "Glue stick",
                  "Ruler", "Marker set", "Eraser", "File folder", "Sketchbook"],
        "variants": ["A5", "A4", "Blue", "12 pcs", "Neon", "Classic"],
    },
    "Seasonal": {
        "price": (30, 300),
        "suppliers": ["FestiveGoods", "PolyHome LLC"],
        "items": ["Christmas lights", "Christmas bauble", "Tinsel garland", "Gift bag", "Candle",
                  "Snowflake decor", "Advent calendar", "Wrapping paper", "Santa figure", "Star topper"],
        "variants": ["Warm white", "Gold", "Red", "Set of 6", "Large", "Classic"],
    },
}

# Store-level weekly rhythm, Monday first, mean 1.0.
WEEKDAY_INDEX = np.array([0.90, 0.88, 0.92, 0.97, 1.08, 1.30, 1.15])
WEEKDAY_INDEX = WEEKDAY_INDEX / WEEKDAY_INDEX.mean()

N_PRODUCTS = 200
PLANTED = {"order": 8, "discount": 6, "visibility": 3, "late_delivery": 2}


@dataclass
class Product:
    product_id: str
    name: str
    category: str
    price: float
    supplier: str
    lead_time_days: int
    case_pack: int
    rate: float  # mean daily demand


def _products(rng: np.random.Generator) -> list[Product]:
    combos = [(c, i, v) for c, spec in CATEGORIES.items() for i in spec["items"] for v in spec["variants"]]
    pick = rng.choice(len(combos), size=N_PRODUCTS, replace=False)
    products = []
    for n, idx in enumerate(sorted(pick)):
        cat, item, variant = combos[idx]
        spec = CATEGORIES[cat]
        tier = rng.choice(["fast", "normal", "slow"], p=[0.2, 0.6, 0.2])
        rate = {"fast": rng.uniform(8, 18), "normal": rng.uniform(2, 8), "slow": rng.uniform(0.4, 2)}[tier]
        lo, hi = spec["price"]
        price = round(float(rng.uniform(lo, hi)) / 5) * 5 - 0.1  # retail-style 49.9
        products.append(Product(
            product_id=f"P{n + 1:03d}",
            name=f"{item} {variant}",
            category=cat,
            price=round(price, 2),
            supplier=str(rng.choice(spec["suppliers"])),
            lead_time_days=int(rng.integers(2, 7)),
            case_pack=int(rng.choice([6, 12, 24])),
            rate=round(float(rate), 2),
        ))
    return products


def _round_case(qty: float, pack: int) -> int:
    return int(max(pack, math.ceil(qty / pack) * pack))


def _simulate(p: Product, demand: np.ndarray, start_stock: int, *, ordering_until: int | None,
              extra: tuple[int, int] | None = None):
    """Forward simulation of one product. Returns sales, end-of-day stock, deliveries."""
    days = len(demand)
    rate = p.rate
    stock = start_stock
    pipeline: list[tuple[int, int, int]] = []  # (order_day, arrive_day, qty)
    sales = np.zeros(days, dtype=int)
    stock_end = np.zeros(days, dtype=int)
    deliveries = []
    for d in range(days):
        for o in [x for x in pipeline if x[1] == d]:
            stock += o[2]
            deliveries.append((o[0], o[1], o[1], o[2]))
            pipeline.remove(o)
        if extra and extra[0] == d:
            stock += extra[1]
            deliveries.append((max(0, d - p.lead_time_days), d, d, extra[1]))
        sold = int(min(demand[d], stock))
        sales[d] = sold
        stock -= sold
        stock_end[d] = stock
        on_order = sum(x[2] for x in pipeline)
        if (ordering_until is None or d < ordering_until) and stock + on_order < rate * (p.lead_time_days + 7) * 1.1:
            qty = _round_case(rate * (p.lead_time_days + 14), p.case_pack)
            pipeline.append((d, d + p.lead_time_days, qty))
    for o in pipeline:  # still in transit at the end of the history
        deliveries.append((o[0], o[1], None, o[2]))
    return sales, stock_end, deliveries


def generate(settings: Settings = SETTINGS, out_dir: Path | None = None) -> Path:
    rng = np.random.default_rng(settings.seed)
    out = Path(out_dir or settings.data_dir)
    out.mkdir(parents=True, exist_ok=True)

    days = settings.history_days
    dates = [settings.today - timedelta(days=days - i) for i in range(days)]
    last = days - 1
    products = _products(rng)

    # ---- store events -------------------------------------------------
    events = []
    traffic = np.ones(days)
    outage_days = sorted(rng.choice(np.arange(5, days - 20), size=4, replace=False).tolist()) + [last]
    for d in outage_days:
        hours = 8 if d == last else int(rng.integers(4, 9))
        factor = 0.5 if d == last else 1 - 0.05 * hours
        traffic[d] *= factor
        events.append({"date": dates[d], "type": "power_outage", "product_id": "", "hours": hours, "uplift": round(factor, 2)})
    alert_days = sorted(rng.choice([d for d in range(days - 16) if d not in outage_days], size=8, replace=False).tolist())
    for d in alert_days:
        hours = int(rng.integers(1, 5))
        factor = 1 - 0.08 * hours
        traffic[d] *= factor
        events.append({"date": dates[d], "type": "air_raid_alert", "product_id": "", "hours": hours, "uplift": round(factor, 2)})

    # ---- choose planted products (disjoint, non-seasonal) -------------
    pool = [p for p in products if p.category != "Seasonal"]
    order_ids = [p for p in pool if p.rate >= 2.5 and p.lead_time_days >= 3]
    order_ids = list(rng.choice(order_ids, size=PLANTED["order"], replace=False))
    rest = [p for p in pool if p not in order_ids]
    discount_ids = list(rng.choice(rest, size=PLANTED["discount"], replace=False))
    rest = [p for p in rest if p not in discount_ids and p.rate >= 3]
    vis_ids = list(rng.choice(rest, size=PLANTED["visibility"], replace=False))
    rest = [p for p in rest if p not in vis_ids]
    late_ids = list(rng.choice(rest, size=PLANTED["late_delivery"], replace=False))
    for p in discount_ids:  # slow movers with far too much stock
        p.rate = round(float(rng.uniform(0.2, 0.6)), 2)

    planted_ids = {p.product_id for p in order_ids + discount_ids + vis_ids + late_ids}

    # ---- promotions (avoid planted products and the last 21 days) -----
    promo = np.ones((len(products), days))
    promo_candidates = [i for i, p in enumerate(products) if p.product_id not in planted_ids]
    for i in rng.choice(promo_candidates, size=15, replace=False):
        start = int(rng.integers(5, days - 28))
        promo[i, start:start + 7] = 1.7
        for d in range(start, start + 7):
            events.append({"date": dates[d], "type": "promotion", "product_id": products[i].product_id, "hours": 0, "uplift": 1.7})

    weekday = np.array([WEEKDAY_INDEX[dt.weekday()] for dt in dates])
    season_ramp = np.linspace(0.5, 1.6, days)

    sales_rows, stock_rows, delivery_rows, key_rows = [], [], [], []
    for i, p in enumerate(products):
        lam = p.rate * weekday * traffic * promo[i]
        if p.category == "Seasonal":
            lam = lam * season_ramp
        if p in vis_ids:
            lam[-21:] *= 0.25  # product moved out of sight: sales collapse while stock is fine
        demand = rng.poisson(lam)

        start_stock = _round_case(p.rate * rng.uniform(14, 30), p.case_pack)
        if p in order_ids:
            target_end = max(1, round(p.rate * rng.uniform(0.8, 1.8)))
            for freeze in range(days - 18, 10, -1):
                _, st, _ = _simulate(p, demand, start_stock, ordering_until=freeze - p.lead_time_days)
                need = target_end + int(demand[freeze:].sum()) - int(st[freeze - 1])
                if need >= 0:
                    extra = (freeze, need) if need > 0 else None
                    sales, stock_end, dels = _simulate(p, demand, start_stock,
                                                       ordering_until=freeze - p.lead_time_days, extra=extra)
                    break
            key_rows.append({"product_id": p.product_id, "expected_action": "ORDER"})
        elif p in discount_ids:
            start_stock = _round_case(rng.uniform(140, 260), p.case_pack)
            sales, stock_end, dels = _simulate(p, demand, start_stock, ordering_until=0)
            key_rows.append({"product_id": p.product_id, "expected_action": "DISCOUNT"})
        elif p in late_ids:
            ordered = last - p.lead_time_days - 3
            sales, stock_end, dels = _simulate(p, demand, start_stock, ordering_until=ordered)
            qty = _round_case(p.rate * (p.lead_time_days + 14), p.case_pack)
            delivery_rows.append({"product_id": p.product_id, "ordered_date": dates[ordered],
                                  "expected_date": dates[ordered + p.lead_time_days],
                                  "actual_date": None, "quantity": qty})
            key_rows.append({"product_id": p.product_id, "expected_action": "CHECK_DELIVERY"})
        else:
            sales, stock_end, dels = _simulate(p, demand, start_stock, ordering_until=None)
            if p in vis_ids:
                key_rows.append({"product_id": p.product_id, "expected_action": "MOVE_TO_FRONT"})

        for d in range(days):
            sales_rows.append({"date": dates[d], "product_id": p.product_id, "units_sold": int(sales[d])})
            stock_rows.append({"date": dates[d], "product_id": p.product_id, "stock_end": int(stock_end[d])})
        for o, exp, act, qty in dels:
            delivery_rows.append({"product_id": p.product_id, "ordered_date": dates[o],
                                  "expected_date": dates[0] + timedelta(days=exp),
                                  "actual_date": None if act is None else dates[act],
                                  "quantity": int(qty)})

    key_rows.append({"product_id": "STORE", "expected_action": "EXPLAIN_ANOMALY"})

    prod_df = pd.DataFrame([{k: v for k, v in p.__dict__.items() if k != "rate"} for p in products])
    deliveries = pd.DataFrame(delivery_rows).sort_values(["ordered_date", "product_id"]).reset_index(drop=True)
    deliveries.insert(0, "delivery_id", [f"D{i + 1:05d}" for i in range(len(deliveries))])

    prod_df.to_csv(out / "products.csv", index=False)
    pd.DataFrame(sales_rows).to_csv(out / "sales.csv", index=False)
    pd.DataFrame(stock_rows).to_csv(out / "stock.csv", index=False)
    deliveries.to_csv(out / "deliveries.csv", index=False)
    pd.DataFrame(events).sort_values(["date", "type"]).to_csv(out / "events.csv", index=False)
    pd.DataFrame(key_rows).to_csv(out / "answer_key.csv", index=False)
    return out


if __name__ == "__main__":
    path = generate()
    print(f"Dataset written to {path}")
