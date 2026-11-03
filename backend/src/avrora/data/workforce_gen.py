"""Synthetic staff data for store #417: employees, availability, shifts, performance, traffic.

All of it is demo data. It uses its own random stream (seed + 1000), so the sales, stock and
event files written by ``generate`` stay exactly as they were. Traffic is derived from the
daily sales totals and the outage and alert days in events.csv.

Planted tension for the workforce agent:
- Oksana V. calls in sick today and tomorrow; Kateryna Z. is on vacation all week.
- Few people can close, and the 17:00-20:00 peak needs the most people.
- Monday morning brings the consolidated DC delivery.
- A scheduled power cut on Wednesday and a promotion weekend.
- Iryna S. is the strongest performer; Yuliia R.'s scan errors rise; Andriy H. is often late.
"""

from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from avrora.config import Settings

OPEN, CLOSE = 8, 21
HOURS = list(range(OPEN, CLOSE))  # hour slots 08..20

# id, name, role, skills, contract h/week, UAH/h, start date, can_open, can_close,
# weekdays off (Mon=0), availability window
EMPLOYEES = [
    ("E01", "Olena K.", "shift_lead", "checkout;customer_service;receiving;inventory", 40, 115, "2021-03-01", 1, 1, (1, 2), (8, 21)),
    ("E02", "Taras M.", "shift_lead", "checkout;customer_service;receiving;inventory", 40, 115, "2022-06-15", 1, 1, (0, 3), (8, 21)),
    ("E03", "Iryna S.", "senior_cashier", "checkout;customer_service;merchandising", 40, 98, "2020-09-01", 1, 1, (1, 6), (8, 21)),
    ("E04", "Mykola P.", "senior_cashier", "checkout;customer_service;replenishment", 40, 95, "2023-02-01", 0, 1, (3, 4), (8, 21)),
    ("E05", "Oksana V.", "cashier", "checkout;customer_service;replenishment", 40, 85, "2023-08-01", 1, 0, (5, 6), (8, 21)),
    ("E06", "Andriy H.", "cashier", "checkout;customer_service", 30, 82, "2024-04-01", 0, 1, (0, 2), (8, 21)),
    ("E07", "Nataliia B.", "cashier", "checkout;customer_service;merchandising", 24, 80, "2025-09-01", 0, 0, (3, 6), (8, 15)),
    ("E08", "Dmytro L.", "cashier", "checkout;replenishment", 20, 80, "2025-10-01", 0, 1, (1, 4), (15, 21)),
    ("E09", "Yuliia R.", "cashier", "checkout;customer_service", 32, 82, "2024-01-15", 0, 0, (2, 4), (8, 21)),
    ("E10", "Serhiy T.", "stocker", "receiving;replenishment;inventory", 40, 88, "2022-11-01", 1, 0, (2, 6), (8, 21)),
    ("E11", "Vasyl D.", "stocker", "receiving;replenishment", 32, 85, "2023-05-01", 0, 0, (1, 3), (8, 21)),
    ("E12", "Kateryna Z.", "merchandiser", "merchandising;replenishment;customer_service", 32, 90, "2022-03-01", 0, 0, (5, 6), (8, 21)),
    ("E13", "Bohdan F.", "stocker", "receiving;replenishment;inventory", 24, 82, "2025-03-01", 0, 1, (0, 4), (8, 21)),
    ("E14", "Halyna O.", "senior_cashier", "checkout;customer_service;merchandising", 36, 95, "2021-10-01", 1, 1, (0, 2), (8, 21)),
]

SICK = {"E05": [0, 1]}  # days after today: sick call today and tomorrow
VACATION = {"E12": (-7, 7)}  # days relative to today, inclusive
FUTURE_DAYS = 7

# Share of the day's customers per hour 08..20.
CURVE_WEEKDAY = np.array([3.5, 5.0, 6.0, 7.0, 8.5, 8.0, 7.0, 7.0, 8.0, 10.0, 11.0, 9.5, 7.5])
CURVE_WEEKEND = np.array([3.0, 5.0, 7.0, 8.5, 9.5, 9.5, 9.0, 8.5, 8.5, 8.5, 8.5, 8.0, 6.5])

# Store calendar ahead (demo): scheduled power cut, promotion weekend, DC delivery.
CALENDAR = [
    (0, "delivery", "08:00", "11:00", "Consolidated DC delivery", 120),
    (2, "power", "12:00", "16:00", "Scheduled power cut (queue 3), tills on generator", 0.6),
    (4, "promotion", "08:00", "21:00", "Winter home weekend promotion", 1.2),
    (5, "promotion", "08:00", "21:00", "Winter home weekend promotion", 1.2),
    (6, "promotion", "08:00", "21:00", "Winter home weekend promotion", 1.2),
]


def _split(total: int, weights: np.ndarray) -> list[int]:
    """Whole numbers that add up to total, in proportion to weights (largest remainder)."""
    share = weights / weights.sum() * total
    base = np.floor(share).astype(int)
    order = np.argsort(-(share - base), kind="stable")
    for i in order[: total - base.sum()]:
        base[i] += 1
    return base.tolist()


def _window(rng: np.random.Generator, hours: int) -> tuple[int, int]:
    start = int(rng.integers(OPEN, CLOSE - hours + 1))
    return start, start + hours


def generate_workforce(settings: Settings, out: Path) -> None:
    rng = np.random.default_rng(settings.seed + 1000)
    today = settings.today
    sales = pd.read_csv(out / "sales.csv")
    events = pd.read_csv(out / "events.csv")
    daily = sales.groupby("date")["units_sold"].sum()
    hist_dates = [date.fromisoformat(d) for d in daily.index]

    # ---- employees ------------------------------------------------------
    emp_rows = [{"employee_id": e[0], "name": e[1], "role": e[2], "skills": e[3], "contract_hours_week": e[4],
                 "hourly_cost_uah": e[5], "start_date": e[6], "can_open": bool(e[7]), "can_close": bool(e[8])}
                for e in EMPLOYEES]

    # ---- availability: history + 7 days ahead ---------------------------
    first = hist_dates[0]
    all_days = [first + timedelta(days=i) for i in range((today - first).days + FUTURE_DAYS)]
    past_vacation = {"E10": (date(2026, 8, 17), date(2026, 8, 30)), "E03": (date(2026, 9, 14), date(2026, 9, 20))}
    avail_rows = []
    for e in EMPLOYEES:
        eid, off, (a, b) = e[0], e[9], e[10]
        sick_p = 0.07 if eid == "E06" else 0.015
        for d in all_days:
            rel = (d - today).days
            status, note = "available", ""
            r = rng.random()
            if d.weekday() in off:
                status, note = "day_off", "Regular day off"
            if eid in VACATION and VACATION[eid][0] <= rel <= VACATION[eid][1] or eid in past_vacation and past_vacation[eid][0] <= d <= past_vacation[eid][1]:
                status, note = "vacation", "Annual leave"
            elif eid in SICK and rel in SICK[eid]:
                status, note = "sick", "Called in sick" if rel == 0 else "Sick note"
            elif rel < 0 and status == "available" and r < sick_p:
                status, note = "sick", "Called in sick"
            if eid == "E07" and status == "available":
                note = "Student: mornings only"
            if eid == "E08" and status == "available":
                note = "Evenings only"
            on = status == "available"
            avail_rows.append({"date": d.isoformat(), "employee_id": eid,
                               "available_from": f"{a:02d}:00" if on else "", "available_to": f"{b:02d}:00" if on else "",
                               "status": status, "note": note})
    avail = pd.DataFrame(avail_rows)

    # ---- past shifts ----------------------------------------------------
    emp = {e[0]: e for e in EMPLOYEES}
    shift_rows = []
    past = avail[avail["date"] < today.isoformat()]
    for d, grp in past.groupby("date", sort=True):
        on = grp[grp["status"] == "available"]["employee_id"].tolist()
        for i, eid in enumerate(on):
            e = emp[eid]
            a, b = e[10]
            length = 8 if e[4] >= 36 else 7 if e[4] >= 30 else 6
            if b - a <= length:
                s, t = a, b
            elif e[7] and (i % 3 == 0):
                s, t = OPEN, OPEN + length
            elif e[8] and (i % 3 != 2):
                s, t = CLOSE - length, CLOSE
            else:
                s = int(rng.integers(a, b - length + 1))
                t = s + length
            skills = e[3].split(";")
            tasks = [skills[0]] + ([skills[1]] if len(skills) > 1 and rng.random() < 0.6 else [])
            shift_rows.append({"date": d, "employee_id": eid, "start": f"{s:02d}:00", "end": f"{t:02d}:00",
                               "tasks": ";".join(tasks)})
    shifts = pd.DataFrame(shift_rows).sort_values(["date", "start", "employee_id"])

    # ---- weekly performance (12 weeks) ----------------------------------
    monday = today - timedelta(days=today.weekday())
    weeks = [monday - timedelta(weeks=12 - i) for i in range(12)]
    perf_rows = []
    for e in EMPLOYEES:
        eid, role, skills = e[0], e[2], e[3].split(";")
        scan = {"shift_lead": 100, "senior_cashier": 112, "cashier": 96}.get(role, 0)
        cases = {"stocker": 30, "shift_lead": 24}.get(role, 0)
        shelves = {"stocker": 130, "merchandiser": 115}.get(role, 100 if "replenishment" in skills else 0)
        err = 0.6 if scan else 0.0
        punct, rating = 96.0, 4.5
        if eid == "E03":
            scan, err, punct, rating = 138, 0.2, 99.5, 4.9
        if eid == "E10":
            cases = 34
        for w, ws in enumerate(weeks):
            noise = lambda s: float(rng.normal(0, s))
            we = ws + timedelta(days=6)
            absn = int(((avail["employee_id"] == eid) & (avail["status"] == "sick")
                        & (avail["date"] >= ws.isoformat()) & (avail["date"] <= we.isoformat())).sum())
            e_err = err + (0.17 * w if eid == "E09" else 0.0)
            e_punct = punct - (1.5 * w if eid == "E06" else 0.0)
            ramp = 1 + (0.01 * w if eid in ("E07", "E08") else 0)  # new starters get faster
            perf_rows.append({
                "week_start": ws.isoformat(), "employee_id": eid,
                "items_scanned_per_hour": round(scan * ramp + noise(4), 1) if scan else 0.0,
                "cases_received_per_hour": round(cases + noise(1.5), 1) if cases else 0.0,
                "shelves_replenished_per_hour": round(shelves * ramp + noise(5), 1) if shelves else 0.0,
                "scan_error_rate": round(max(0.05, e_err + noise(0.08)), 2) if scan else 0.0,
                "punctuality_pct": round(min(100.0, e_punct + noise(1.2)), 1),
                "absences": absn,
                "customer_rating": round(min(5.0, max(1.0, rating - (0.04 * w if eid == "E09" else 0) + noise(0.08))), 2),
            })
    perf = pd.DataFrame(perf_rows)
    # Station skills (own stream so traffic stays put): heavy lifting for the receiving dock,
    # counting accuracy for inventory, facing neatness for promo displays.
    rng3 = np.random.default_rng(settings.seed + 2000)
    lift_base = {"stocker": 82, "shift_lead": 66, "merchandiser": 55}
    audit_base = {"shift_lead": 98.2, "stocker": 97.0}
    face_base = {"merchandiser": 86, "senior_cashier": 72, "cashier": 64}
    special = {"E10": (93, None, None), "E01": (None, 99.4, None), "E03": (None, None, 88), "E13": (None, 98.8, None)}
    extra = {}
    for e in EMPLOYEES:
        sp = special.get(e[0], (None, None, None))
        extra[e[0]] = (sp[0] or lift_base.get(e[2], 45), sp[1] or audit_base.get(e[2], 95.0), sp[2] or face_base.get(e[2], 60))
    perf["heavy_lifting"] = [int(min(100, max(1, round(extra[r][0] + rng3.normal(0, 2))))) for r in perf["employee_id"]]
    perf["audit_accuracy"] = [round(min(100.0, extra[r][1] + float(rng3.normal(0, 0.3))), 1) for r in perf["employee_id"]]
    perf["facing_neatness"] = [int(min(100, max(1, round(extra[r][2] + rng3.normal(0, 2))))) for r in perf["employee_id"]]

    # ---- hourly traffic from daily sales --------------------------------
    disrupted = {}
    for _, ev in events[events["type"].isin(["power_outage", "air_raid_alert"])].iterrows():
        hours = int(ev["hours"])
        s, t = _window(rng, hours) if ev["date"] != hist_dates[-1].isoformat() else (10, 18)
        disrupted[ev["date"]] = (s, t, 0.35 if ev["type"] == "power_outage" else 0.25)
    traffic_rows = []
    for d in hist_dates:
        units = int(daily[d.isoformat()])
        basket = 2.35 * (1 + float(rng.normal(0, 0.03)))
        tx = round(units / basket)
        cust = round(tx * float(rng.uniform(1.10, 1.16)))
        curve = (CURVE_WEEKEND if d.weekday() >= 5 else CURVE_WEEKDAY).copy()
        if d.weekday() == 4:
            curve[9:12] *= 1.12  # Friday evening
        curve = curve * np.exp(rng.normal(0, 0.06, len(curve)))
        if d.isoformat() in disrupted:
            s, t, f = disrupted[d.isoformat()]
            curve[s - OPEN:t - OPEN] *= f
        for h, c, x in zip(HOURS, _split(cust, curve), _split(tx, curve)):
            traffic_rows.append({"date": d.isoformat(), "hour": h, "customers": max(c, x), "transactions": x})
    traffic = pd.DataFrame(traffic_rows)

    cal_rows = [{"date": (today + timedelta(days=rel)).isoformat(), "kind": k, "from": f, "to": t, "label": lab, "value": v}
                for rel, k, f, t, lab, v in CALENDAR]
    win_rows = [{"date": d, "from": f"{s:02d}:00", "to": f"{t:02d}:00", "traffic_factor": f_}
                for d, (s, t, f_) in sorted(disrupted.items())]

    pd.DataFrame(emp_rows).to_csv(out / "employees.csv", index=False)
    avail.to_csv(out / "availability.csv", index=False)
    shifts.to_csv(out / "shifts.csv", index=False)
    perf.to_csv(out / "performance.csv", index=False)
    traffic.to_csv(out / "traffic.csv", index=False)
    pd.DataFrame(cal_rows).to_csv(out / "store_calendar.csv", index=False)
    pd.DataFrame(win_rows).to_csv(out / "disruption_windows.csv", index=False)
