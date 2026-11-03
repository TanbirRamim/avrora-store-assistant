import json
import sys
from pathlib import Path

# Ensure UTF-8 output on Windows consoles
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import JSON_OUTPUT_PATH, METRICS_OUTPUT_PATH
from ai.ai_prompts import format_store_for_ai_reader, format_chain_overview_for_ai_predictions


def run_ai_reader_demonstration():
    print("=" * 70)
    print("🤖 AI READER & PREDICTION ENGINE INTEGRATION DEMO (ENGLISH)")
    print("=" * 70)

    if not JSON_OUTPUT_PATH.exists() or not METRICS_OUTPUT_PATH.exists():
        print(f"Error: Datasheet file {JSON_OUTPUT_PATH} not found.")
        return

    with open(JSON_OUTPUT_PATH, "r", encoding="utf-8") as f:
        rows = json.load(f)

    with open(METRICS_OUTPUT_PATH, "r", encoding="utf-8") as f:
        summary = json.load(f)

    # 1. Single Store Advisor (Top risk store)
    top_threat = rows[0] if rows else None
    if top_threat:
        prompt_payload = format_store_for_ai_reader(top_threat)
        print("\n[1] Generated Structured LLM Context (Single Store Advisor):")
        print("-" * 70)
        print(prompt_payload)
        print("-" * 70)

        city = top_threat.get('city') or top_threat.get('city_uk')
        action = top_threat.get('action_en') or top_threat.get('action_uk')

        print("\n[2] Sample AI Reader Generation for Store Manager:")
        print(f"""
>>> OPERATIONAL DIRECTIVE FOR STORE MANAGER ({top_threat.get('manager_name')}):
1. [SAFETY]: High-threat {top_threat.get('threat_zone')} Zone. {action}
2. [ENERGY AUTONOMY]: Switch communication to Starlink backup. Current fuel reserve ({top_threat.get('generator_fuel_l', 0)} L) provides approximately {int(top_threat.get('generator_fuel_l', 0)/3)} hours of generator runtime.
3. [DEMAND SURGE]: High probability of immediate post-alarm surge (+70%) for 10-20k mAh powerbanks, AA batteries, and bottled water. Prepare a dedicated front-of-store pallet display once the siren clears.
""")

    # 2. Chain-wide logistics prediction
    overview_payload = format_chain_overview_for_ai_predictions(summary, rows[:5])
    print("\n[3] Generated Supply Chain Context for HQ AI Prediction:")
    print("-" * 70)
    print(overview_payload)


if __name__ == "__main__":
    run_ai_reader_demonstration()
