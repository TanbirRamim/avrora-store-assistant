import json
import logging
from typing import List, Dict, Any
from pathlib import Path
import pandas as pd

from config import CSV_OUTPUT_PATH, JSON_OUTPUT_PATH, EXCEL_OUTPUT_PATH, METRICS_OUTPUT_PATH

logger = logging.getLogger(__name__)


class DataSheetWriter:
    """
    Exports dual-view war map data into real-time synchronized data sheets:
    - CSV (Excel UTF-8-BOM compatible)
    - Excel with 'Life Safety' and 'Logistics & Supply' sheets
    - Structured JSON for AI models and APIs
    """

    @staticmethod
    def export(rows: List[Dict[str, Any]], summary: Dict[str, Any]) -> Dict[str, str]:
        results = {}

        # 1. Export JSON format
        try:
            with open(JSON_OUTPUT_PATH, "w", encoding="utf-8") as f:
                json.dump(rows, f, ensure_ascii=False, indent=2)
            results["json"] = str(JSON_OUTPUT_PATH)
        except Exception as e:
            logger.error("Failed to write JSON datasheet: %s", e)

        # 2. Export Summary JSON
        try:
            with open(METRICS_OUTPUT_PATH, "w", encoding="utf-8") as f:
                json.dump(summary, f, ensure_ascii=False, indent=2)
            results["summary"] = str(METRICS_OUTPUT_PATH)
        except Exception as e:
            logger.error("Failed to write summary: %s", e)

        # 3. Export Clean CSV
        try:
            df = pd.DataFrame(rows)
            column_order = [
                "store_id", "city", "address", "dist_frontline_km",
                "threat_zone", "alert_status", "action_en", "shelter_nearby",
                "comms_status", "ack_status", "power_status",
                "generator_fuel_l", "generator_runtime_hours",
                "delivery_eta", "priority_restock", "surge_level", "surge_category",
                "manager_name", "manager_phone", "updated_at"
            ]
            cols_to_use = [c for c in column_order if c in df.columns] + [c for c in df.columns if c not in column_order]
            df = df[cols_to_use]

            df.to_csv(CSV_OUTPUT_PATH, index=False, encoding="utf-8-sig")
            results["csv"] = str(CSV_OUTPUT_PATH)
        except Exception as e:
            logger.error("Failed to write CSV datasheet: %s", e)

        # 4. Export multi-tab Excel workbook
        try:
            with pd.ExcelWriter(EXCEL_OUTPUT_PATH, engine="openpyxl") as writer:
                # Tab 1: Life Safety View
                safety_cols = [
                    "store_id", "city", "address", "dist_frontline_km",
                    "threat_zone", "alert_label", "action_en", "shelter_nearby",
                    "comms_status", "ack_label", "manager_name", "manager_phone"
                ]
                safety_df = df[[c for c in safety_cols if c in df.columns]]
                safety_df.to_excel(writer, sheet_name="Life Safety View", index=False)

                # Tab 2: Logistics & Supply View
                logistics_cols = [
                    "store_id", "city", "dist_frontline_km", "threat_zone",
                    "surge_level", "surge_category", "delivery_eta", "priority_restock",
                    "power_status", "generator_fuel_l", "generator_runtime_hours", "comms_status"
                ]
                logistics_df = df[[c for c in logistics_cols if c in df.columns]]
                logistics_df.to_excel(writer, sheet_name="Logistics & Supply View", index=False)

                # Tab 3: Summary
                summary_df = pd.DataFrame([summary])
                summary_df.to_excel(writer, sheet_name="Chain Summary", index=False)

            results["excel"] = str(EXCEL_OUTPUT_PATH)
        except Exception as e:
            logger.error("Failed to write Excel datasheet: %s", e)

        return results
