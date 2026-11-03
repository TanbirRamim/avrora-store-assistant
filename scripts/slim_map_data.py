"""Write the compact GeoJSON the in-app map loads from the full OpenStreetMap export.

Usage: python3 scripts/slim_map_data.py
Reads frontend/public/map/ukraine-locations.geojson, writes frontend/public/map/locations.min.json.
"""

import json
from pathlib import Path

MAP = Path(__file__).resolve().parents[1] / "frontend/public/map"
# The export fills missing names with German category labels; those are not real names.
PLACEHOLDER_NAMES = {"Lagerhalle", "Kaufhaus", "Lagerstandort", "Logistik-/Distributionszentrum"}
CATEGORY = {"department_store": "store", "warehouse": "warehouse", "logistics_center": "logistics"}


def clean(v: str) -> str:
    return v.strip().strip('"«»„“”').strip()


def main() -> None:
    src = json.loads((MAP / "ukraine-locations.geojson").read_text())
    out = []
    for f in src["features"]:
        p = f["properties"]
        lon, lat = f["geometry"]["coordinates"]
        props = {"id": f["id"], "c": CATEGORY[p["category"]]}
        if p["status"] != "active_or_unknown":
            props["s"] = p["status"]
        for key, field in (("n", "name"), ("a", "address"), ("o", "operator"), ("b", "brand"), ("w", "website")):
            value = clean(p.get(field) or "")
            if value and not (key == "n" and value in PLACEHOLDER_NAMES):
                props[key] = value
        out.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
                    "properties": props})
    dst = MAP / "locations.min.json"
    dst.write_text(json.dumps({"type": "FeatureCollection", "features": out}, ensure_ascii=False, separators=(",", ":")))
    print(f"{len(out)} locations, {dst.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
