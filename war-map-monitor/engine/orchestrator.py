import json
import time
import logging
from typing import List, Dict, Any, Tuple
from pathlib import Path

from config import DATA_DIR
from collectors.deepstate_reader import DeepStateReader
from collectors.alerts_reader import AlertsReader
from engine.geo_engine import calculate_min_distance_to_frontline
from engine.risk_scorer import RiskScorer
from datasheet.writer import DataSheetWriter

logger = logging.getLogger(__name__)

STORES_FILE = DATA_DIR / "avrora_stores.json"
ACK_FILE = DATA_DIR / "acknowledgments.json"


class WarMapOrchestrator:
    """
    Main orchestrator that joins war map telemetry with Avrora stores
    to maintain dual-mode Data Sheets (Life Safety + Logistics & Supply).
    """

    def __init__(self, alerts_token: str = None):
        self.deepstate_reader = DeepStateReader()
        self.alerts_reader = AlertsReader(api_token=alerts_token)
        self.stores: List[Dict[str, Any]] = self._load_stores()
        self.acknowledgments: Dict[str, Any] = self._load_acknowledgments()

    def _load_stores(self) -> List[Dict[str, Any]]:
        if not STORES_FILE.exists():
            raise FileNotFoundError(f"Stores file missing at: {STORES_FILE}")
        with open(STORES_FILE, "r", encoding="utf-8") as f:
            return json.load(f)

    def _load_acknowledgments(self) -> Dict[str, Any]:
        if ACK_FILE.exists():
            try:
                with open(ACK_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {}

    def _save_acknowledgments(self):
        try:
            with open(ACK_FILE, "w", encoding="utf-8") as f:
                json.dump(self.acknowledgments, f, indent=2)
        except Exception as e:
            logger.warning("Failed saving acks: %s", e)

    def acknowledge_shelter(self, store_id: str, manager_name: str = "Manager") -> Dict[str, Any]:
        now_str = time.strftime("%H:%M:%S", time.localtime())
        self.acknowledgments[store_id] = {
            "status": "CONFIRMED_IN_SHELTER",
            "confirmed_at": now_str,
            "confirmed_by": manager_name
        }
        self._save_acknowledgments()
        return self.acknowledgments[store_id]

    def reset_shelter_ack(self, store_id: str):
        if store_id in self.acknowledgments:
            del self.acknowledgments[store_id]
            self._save_acknowledgments()

    def process_cycle(self, force_refresh_maps: bool = False) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        start_time = time.time()
        now_str = time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime())
        self.stores = self._load_stores()

        # 1. Fetch frontline coordinates
        if force_refresh_maps:
            self.deepstate_reader.force_refresh = True
        frontline_points = self.deepstate_reader.get_frontline_points()
        frontline_meta = self.deepstate_reader.source_metadata

        # 2. Fetch active alerts
        alerts_info = self.alerts_reader.get_active_alerts(force_refresh=force_refresh_maps)

        # 3. Process each store
        rows: List[Dict[str, Any]] = []

        stores_under_alarm = 0
        stores_red = 0
        stores_orange = 0
        stores_yellow = 0
        stores_green = 0
        stores_evacuated_confirmed = 0
        stores_pending_ack = 0

        for s in self.stores:
            lat = s.get("lat")
            lon = s.get("lon")
            sid = s.get("id")

            # Distance to frontline
            dist_km = calculate_min_distance_to_frontline(lat, lon, frontline_points)

            # Score & Actions
            eval_res = RiskScorer.evaluate_store(s, dist_km, alerts_info)

            # Determine Comms & Acknowledgment Status
            is_siren = (eval_res["alert_status"] != "CLEAR")
            ack_data = self.acknowledgments.get(sid)

            if is_siren:
                stores_under_alarm += 1
                if ack_data and ack_data.get("status") == "CONFIRMED_IN_SHELTER":
                    ack_status = "CONFIRMED_IN_SHELTER"
                    ack_label = f"Confirmed in Shelter ({ack_data.get('confirmed_at')})"
                    stores_evacuated_confirmed += 1
                else:
                    ack_status = "PENDING_CONFIRMATION"
                    ack_label = "AWAITING CONFIRMATION"
                    stores_pending_ack += 1
            else:
                ack_status = "ALL_CLEAR"
                ack_label = "Trading Normally"

            if eval_res["threat_zone"] == "RED":
                stores_red += 1
            elif eval_res["threat_zone"] == "ORANGE":
                stores_orange += 1
            elif eval_res["threat_zone"] == "YELLOW":
                stores_yellow += 1
            else:
                stores_green += 1

            row = {
                "store_id": sid,
                "city": s.get("city"),
                "name": s.get("name"),
                "address": s.get("address"),
                "oblast": s.get("oblast"),
                "lat": lat,
                "lon": lon,
                "dist_frontline_km": dist_km,
                "threat_zone": eval_res["threat_zone"],
                "threat_zone_label": eval_res["threat_zone_label"],
                "alert_status": eval_res["alert_status"],
                "alert_label": eval_res["alert_label"],
                "risk_score": eval_res["risk_score"],
                "risk_grade": eval_res["risk_grade"],
                "store_mode": eval_res["store_mode"],
                "action_en": eval_res["action_en"],
                "action_color": eval_res["action_color"],
                "shelter_nearby": s.get("shelter_nearby"),
                "manager_name": s.get("manager_name"),
                "manager_phone": s.get("manager_phone"),
                
                # Comms & Acknowledgment Loop
                "comms_status": s.get("comms_status", "online"), # online, starlink, cellular, offline
                "ack_status": ack_status,
                "ack_label": ack_label,
                
                # Power & Generator
                "power_status": s.get("power_status", "grid"), # grid, generator, blackout
                "generator_fuel_l": s.get("generator_fuel_l", 0),
                "generator_runtime_hours": eval_res["generator_runtime_hours"],
                
                # Logistics & Supply
                "delivery_eta": s.get("delivery_eta", "On Schedule"),
                "priority_restock": s.get("priority_restock", "Standard"),
                "surge_level": eval_res["surge_level"],
                "surge_category": eval_res["surge_category"],
                
                "updated_at": now_str
            }
            rows.append(row)

        # Sort: Pending emergencies on top, then by risk score
        def sort_key(r):
            # Pending confirmation for active siren gets highest priority
            is_pending = (1 if r["ack_status"] == "PENDING_CONFIRMATION" else 0)
            return (is_pending, r["risk_score"])

        rows.sort(key=sort_key, reverse=True)

        # Summary
        summary = {
            "total_stores": len(rows),
            "stores_under_alarm": stores_under_alarm,
            "stores_pending_ack": stores_pending_ack,
            "stores_evacuated_confirmed": stores_evacuated_confirmed,
            "stores_in_red_zone": stores_red,
            "stores_in_orange_zone": stores_orange,
            "stores_in_yellow_zone": stores_yellow,
            "stores_in_green_zone": stores_green,
            "stores_on_generator": sum(1 for r in rows if r["power_status"] == "generator"),
            "stores_blackout": sum(1 for r in rows if r["power_status"] == "blackout"),
            "alerts_source": alerts_info.get("source", "Live Ukrainian Civil Defense Alerts API"),
            "alerts_is_simulated": alerts_info.get("is_simulated", False),
            "frontline_data_source": frontline_meta.get("source"),
            "frontline_nodes_tracked": frontline_meta.get("total_nodes"),
            "cycle_duration_ms": round((time.time() - start_time) * 1000, 1),
            "generated_at": now_str
        }

        # Export
        DataSheetWriter.export(rows, summary)

        return rows, summary
