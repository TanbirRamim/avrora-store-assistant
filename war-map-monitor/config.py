import os
from pathlib import Path
from dotenv import load_dotenv

# Load local environment variables if present
load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
OUTPUT_DIR = BASE_DIR / "output"

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Alerts.in.ua configuration
# Free or commercial token from https://alerts.in.ua/
ALERTS_API_TOKEN = os.getenv("ALERTS_IN_UA_TOKEN", "")
ALERTS_API_URL = "https://api.alerts.in.ua/v1/alerts/active.json"

# DeepStateMap data sources (mirrors + fallback)
DEEPSTATE_GEOJSON_MIRRORS = [
    # Daily contact-line GeoJSON with source timestamp and explicit contact_line geometry.
    "https://longlinecode.github.io/russo-ukrainian-front-daily/data/latest.geojson",
    # UN OCHA/ISW front-line feature service as an independent fallback.
    "https://gis.unocha.org/server/rest/services/Hosted/UKR_Front_Line/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson&outSR=4326",
]

# Danger Zone Distance Thresholds (Kilometers)
RED_ZONE_KM = 25.0       # Direct barrel artillery, FPV drones, mortars
ORANGE_ZONE_KM = 65.0    # MLRS (Tornado-S, Smerch, Uragan), Guided Glide Bombs (KAB)
YELLOW_ZONE_KM = 120.0   # Operational depth: frequent tactical aviation & drone corridors

# File paths for outputs
CSV_OUTPUT_PATH = OUTPUT_DIR / "avrora_war_threat_sheet.csv"
JSON_OUTPUT_PATH = OUTPUT_DIR / "avrora_war_threat_sheet.json"
EXCEL_OUTPUT_PATH = OUTPUT_DIR / "avrora_war_threat_sheet.xlsx"
METRICS_OUTPUT_PATH = OUTPUT_DIR / "avrora_threat_summary.json"

# Polling Interval
DEFAULT_POLL_INTERVAL = int(os.getenv("POLL_INTERVAL_SECONDS", "45"))
