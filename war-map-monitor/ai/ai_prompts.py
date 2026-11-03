"""
AI Reader and Suggestion Interface for Avrora Store War Map System (Clean & Focused).
"""

from typing import Dict, Any, List


WAR_MAP_AI_SYSTEM_PROMPT = """You are a specialized War Map Safety & Operational AI Assistant for Avrora stores in Ukraine.
Your task is to ingest real-time war map proximity telemetry (distance to frontline from DeepStateMap) and air siren statuses (from Alerts.in.ua) to give concise, unambiguous safety directives to store managers.

Core Rules:
1. Priority: Life safety of store employees and civilian customers.
2. Under active sirens in Red/Orange zones: Immediate checkout suspension and evacuation to the designated shelter.
3. Keep instructions concise, actionable, and free of unnecessary clutter.
"""


def format_store_for_ai_reader(store_row: Dict[str, Any]) -> str:
    """
    Serializes a single store into a concise briefing for an LLM agent.
    """
    return f"""### [STORE SITUATION: {store_row.get('store_id')} - {store_row.get('city')}]
- Address: {store_row.get('address')}, {store_row.get('oblast')}
- Frontline Proximity: {store_row.get('dist_frontline_km')} km ({store_row.get('threat_zone_label')})
- Air Siren Status: {store_row.get('alert_label')}
- Store Status: {store_row.get('store_mode')}
- Current Directive: {store_row.get('action_en')}
- Designated Shelter: {store_row.get('shelter_nearby')}
- Store Manager: {store_row.get('manager_name')} ({store_row.get('manager_phone')})

**AI Request:**
Formulate a 2-step immediate safety instruction for this manager based on current frontline proximity and siren status.
"""


def format_chain_overview_for_ai_predictions(summary: Dict[str, Any], critical_stores: List[Dict[str, Any]]) -> str:
    """
    Serializes chain overview for regional security and logistics planning.
    """
    stores_txt = "\n".join([
        f"- {s.get('store_id')} ({s.get('city')}): Frontline {s.get('dist_frontline_km')}km, Zone: {s.get('threat_zone')}, Siren: {s.get('alert_label')}"
        for s in critical_stores[:8]
    ])

    return f"""### [AVRORA CHAIN STATUS OVERVIEW]
- Total Stores Tracked: {summary.get('total_stores')}
- Stores Under Active Siren: {summary.get('stores_under_alarm')}
- Stores in Red Zone (< 25 km): {summary.get('stores_in_red_zone')}
- Stores in Orange Zone (25-65 km): {summary.get('stores_in_orange_zone')}

**Frontline & High-Risk Stores:**
{stores_txt}

**AI Request:**
Summarize the current threat distribution across regions and identify any transport route risks.
"""
