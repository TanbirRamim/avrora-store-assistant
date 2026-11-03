from typing import Optional
from pydantic import BaseModel, Field


class StoreThreatRow(BaseModel):
    store_id: str
    city: str
    name: str
    address: str
    oblast: str
    dist_frontline_km: float
    threat_zone: str
    threat_zone_label: str
    alert_status: str
    alert_label: str
    risk_score: int
    risk_grade: str
    store_mode: str
    action_en: str
    action_color: str
    shelter_nearby: str
    manager_name: str
    manager_phone: str
    
    # Comms & Acknowledgment
    comms_status: str
    ack_status: str
    ack_label: str
    
    # Power & Logistics
    power_status: str
    generator_fuel_l: float
    generator_runtime_hours: float
    delivery_eta: str
    priority_restock: str
    surge_level: str
    surge_category: str
    updated_at: str


class DataSheetSummary(BaseModel):
    total_stores: int
    stores_under_alarm: int
    stores_pending_ack: int
    stores_evacuated_confirmed: int
    stores_in_red_zone: int
    stores_in_orange_zone: int
    stores_in_yellow_zone: int
    stores_in_green_zone: int
    stores_on_generator: int
    stores_blackout: int
    frontline_data_source: str
    frontline_nodes_tracked: int
    generated_at: str
