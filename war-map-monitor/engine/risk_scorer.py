from typing import Dict, Any
from config import RED_ZONE_KM, ORANGE_ZONE_KM, YELLOW_ZONE_KM


OBLAST_MAP = {
    "Donetsk Oblast": "Донецька область",
    "Kharkiv Oblast": "Харківська область",
    "Dnipropetrovsk Oblast": "Дніпропетровська область",
    "Zaporizhzhia Oblast": "Запорізька область",
    "Kherson Oblast": "Херсонська область",
    "Mykolaiv Oblast": "Миколаївська область",
    "Odesa Oblast": "Одеська область",
    "Poltava Oblast": "Полтавська область",
    "Kyiv Oblast": "Київська область",
    "Kyiv": "м. Київ",
    "Kyiv City": "м. Київ",
    "Lviv Oblast": "Львівська область",
    "Sumy Oblast": "Сумська область",
    "Luhansk Oblast": "Луганська область",
    "Chernihiv Oblast": "Чернігівська область",
    "Cherkasy Oblast": "Черкаська область",
    "Vinnytsia Oblast": "Вінницька область",
    "Zhytomyr Oblast": "Житомирська область",
    "Rivne Oblast": "Рівненська область",
    "Volyn Oblast": "Волинська область",
    "Ternopil Oblast": "Тернопільська область",
    "Ivano-Frankivsk Oblast": "Івано-Франківська область",
    "Zakarpattia Oblast": "Закарпатська область",
    "Chernivtsi Oblast": "Чернівецька область",
    "Khmelnytskyi Oblast": "Хмельницька область",
    "Kirovohrad Oblast": "Кіровоградська область",
    "Sevastopol": "Севастополь",
    "Autonomous Republic of Crimea": "Автономна Республіка Крим"
}


class RiskScorer:
    """
    Evaluates real-time war map telemetry to generate:
    1. Life Safety: Nuanced evacuation directives with strict color hierarchy.
    2. Supply Chain & Logistics: Surge demand prediction, route status, and generator runtime.
    """

    @staticmethod
    def evaluate_store(store: Dict[str, Any], dist_km: float, alerts_info: Dict[str, Any]) -> Dict[str, Any]:
        oblast = store.get("oblast", "")
        hromada = store.get("hromada", "")
        city = store.get("city", "")

        active_regions = alerts_info.get("active_regions", [])
        active_hromadas = alerts_info.get("active_hromadas", [])

        oblast_uk = OBLAST_MAP.get(oblast, oblast)
        city_uk = "м. Київ" if city == "Kyiv" else ""

        # 1. Siren Alert Status
        if hromada in active_hromadas:
            alert_status = "ACTIVE_HROMADA"
            alert_label = "🚨 SIREN ACTIVE (LOCAL)"
            alert_multiplier = 40
        elif (oblast in active_regions) or (oblast_uk in active_regions) or (city_uk in active_regions):
            alert_status = "ACTIVE_OBLAST"
            alert_label = "⚠️ SIREN ACTIVE (REGIONAL)"
            alert_multiplier = 25
        else:
            alert_status = "CLEAR"
            alert_label = "🟢 ALL CLEAR"
            alert_multiplier = 0

        # 2. Danger Zone by Proximity
        if dist_km <= RED_ZONE_KM:
            threat_zone = "RED"
            zone_label = "Red Zone (< 25 km)"
            base_score = 60
        elif dist_km <= ORANGE_ZONE_KM:
            threat_zone = "ORANGE"
            zone_label = "Orange Zone (25-65 km)"
            base_score = 40
        elif dist_km <= YELLOW_ZONE_KM:
            threat_zone = "YELLOW"
            zone_label = "Yellow Zone (65-120 km)"
            base_score = 20
        else:
            threat_zone = "GREEN"
            zone_label = "Green Rear (> 120 km)"
            base_score = 5

        # 3. Composite Risk Score (0-100)
        dist_factor = max(0, min(30, int((150 - min(dist_km, 150)) / 5)))
        risk_score = max(0, min(100, base_score + alert_multiplier + dist_factor))

        if risk_score >= 80:
            risk_grade = "CRITICAL"
        elif risk_score >= 60:
            risk_grade = "HIGH"
        elif risk_score >= 40:
            risk_grade = "ELEVATED"
        else:
            risk_grade = "LOW"

        # 4. Strict Color Hierarchy for Directives:
        # - Red: Strictly reserved for active siren emergencies
        # - Amber: Near frontline (<25km) vigilance with clear sirens
        # - Yellow: Glide bomb / radar monitoring
        # - Green / Muted: Normal routine trading
        if alert_status != "CLEAR":
            action_code = "IMMEDIATE_SHELTER"
            action_en = "STOP CHECKOUT & EVACUATE: Immediate strike threat. Lock registers, move shoppers and staff to shelter."
            action_color = "red"  # Bright red, urgent emergency
            store_mode = "CLOSED (IN SHELTER)"
        elif threat_zone == "RED":
            action_code = "HEIGHTENED_VIGILANCE"
            action_en = "NEAR FRONTLINE (<25km): Keep bunker doors unlocked, verify Starlink, maintain artillery readiness."
            action_color = "amber"  # Amber warning, not red
            store_mode = "OPEN (HIGH ALERT)"
        elif threat_zone == "ORANGE":
            action_code = "MONITOR_AIR"
            action_en = "GLIDE BOMB RISK (25-65km): Open for trading. Monitor air warnings for prompt shelter compliance."
            action_color = "yellow"  # Yellow caution
            store_mode = "OPEN (MONITORING)"
        else:
            action_code = "NORMAL_OPERATIONS"
            action_en = "NORMAL TRADING: Safe rear area. Routine civil defense monitoring."
            action_color = "green"  # Green / muted normal
            store_mode = "NORMAL TRADING"

        # 5. Logistics & Power Calculations
        fuel_liters = store.get("generator_fuel_l", 0)
        # Standard commercial 15-25kVA generator consumes ~3.2 L/h
        hours_autonomy = round(fuel_liters / 3.2, 1) if fuel_liters else 0.0

        # Surge demand prediction based on risk & alarms
        if threat_zone == "RED" or alert_status != "CLEAR":
            surge_level = "CRITICAL"
            surge_category = "Powerbanks 20k, AA/AAA Batteries, Water 5L"
        elif threat_zone == "ORANGE":
            surge_level = "HIGH"
            surge_category = "LED Flashlights, Bulbs, Thermos Flasks"
        elif threat_zone == "YELLOW":
            surge_level = "ELEVATED"
            surge_category = "Powerbanks 10k, Candles, Wet Wipes"
        else:
            surge_level = "NORMAL"
            surge_category = "Routine Retail Assortment"

        return {
            "dist_to_frontline_km": dist_km,
            "threat_zone": threat_zone,
            "threat_zone_label": zone_label,
            "alert_status": alert_status,
            "alert_label": alert_label,
            "risk_score": risk_score,
            "risk_grade": risk_grade,
            "action_code": action_code,
            "action_en": action_en,
            "action_color": action_color,
            "store_mode": store_mode,
            "generator_runtime_hours": hours_autonomy,
            "surge_level": surge_level,
            "surge_category": surge_category,
        }
