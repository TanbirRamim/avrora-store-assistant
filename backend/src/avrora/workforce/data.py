"""Load the staff data (demo data, see avrora.data.workforce_gen)."""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import pandas as pd

from avrora.config import RULES, SETTINGS


@dataclass(frozen=True)
class Employee:
    employee_id: str
    name: str
    role: str
    skills: tuple[str, ...]
    contract_hours_week: int
    hourly_cost_uah: float
    start_date: str
    can_open: bool
    can_close: bool

    @property
    def lead(self) -> bool:
        return self.role in RULES.lead_roles

    @property
    def week_cap(self) -> float:
        return min(RULES.max_week_hours, float(self.contract_hours_week))


@dataclass(frozen=True)
class StaffData:
    employees: list[Employee]
    availability: pd.DataFrame
    shifts: pd.DataFrame
    performance: pd.DataFrame
    traffic: pd.DataFrame
    calendar: pd.DataFrame
    windows: pd.DataFrame
    deliveries: pd.DataFrame
    products: pd.DataFrame
    sales: pd.DataFrame
    events: pd.DataFrame

    def employee(self, eid: str) -> Employee | None:
        return next((e for e in self.employees if e.employee_id == eid), None)


def load_staff(data_dir: Path | None = None) -> StaffData:
    d = Path(data_dir or SETTINGS.data_dir)
    if not (d / "employees.csv").exists():
        from avrora.data.generate import generate

        generate(out_dir=d)
    emp = pd.read_csv(d / "employees.csv")
    employees = [Employee(r.employee_id, r["name"], r.role, tuple(r.skills.split(";")), int(r.contract_hours_week),
                          float(r.hourly_cost_uah), r.start_date, bool(r.can_open), bool(r.can_close))
                 for _, r in emp.iterrows()]
    s = {"dtype": {"available_from": str, "available_to": str, "note": str}, "keep_default_na": False}
    return StaffData(
        employees=employees,
        availability=pd.read_csv(d / "availability.csv", **s),
        shifts=pd.read_csv(d / "shifts.csv"),
        performance=pd.read_csv(d / "performance.csv"),
        traffic=pd.read_csv(d / "traffic.csv"),
        calendar=pd.read_csv(d / "store_calendar.csv"),
        windows=pd.read_csv(d / "disruption_windows.csv"),
        deliveries=pd.read_csv(d / "deliveries.csv"),
        products=pd.read_csv(d / "products.csv"),
        sales=pd.read_csv(d / "sales.csv"),
        events=pd.read_csv(d / "events.csv"),
    )


@lru_cache(maxsize=1)
def staff() -> StaffData:
    return load_staff()
