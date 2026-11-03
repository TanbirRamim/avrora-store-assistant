"""Write the compact GeoJSON the in-app map loads from the full map exports.

Usage: python3 scripts/slim_map_data.py
Reads, from frontend/public/map/:
  ukraine-locations.geojson    OpenStreetMap warehouses and logistics centres (department stores are skipped)
  avrora-stores.geojson        official Avrora store locator, Ukraine only
  food-infrastructure.geojson  OpenStreetMap food production, beverage and grain sites (no retail)
  supply-chain.geojson         Avrora distribution centres, partners and manufacturers, with sources
Writes frontend/public/map/locations.min.json.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

MAP = Path(__file__).resolve().parents[1] / "frontend/public/map"
# The OSM export fills missing names with German category labels; those are not real names.
PLACEHOLDER_NAMES = {"Lagerhalle", "Kaufhaus", "Lagerstandort", "Logistik-/Distributionszentrum"}
OSM_CATEGORY = {"warehouse": "warehouse", "logistics_center": "logistics"}
# Map-wide active states are the default and are left out.
ACTIVE = {"active", "active_or_unknown"}
DAYS = {"ПН": "Mon", "ВТ": "Tue", "СР": "Wed", "ЧТ": "Thu", "ПТ": "Fri", "СБ": "Sat", "НД": "Sun"}


def hours(note: str) -> str:
    """'ПН - НД 8:00 - 21:00' -> 'Mon–Sun 8:00–21:00' (several spans are joined with ' · ')."""
    spans = re.findall(r"(\w\w) - (\w\w) (\d{1,2}:\d\d) - (\d{1,2}:\d\d)", note)
    if not spans or any(a not in DAYS or b not in DAYS for a, b, _, _ in spans):
        return note.strip()
    return " · ".join(f"{DAYS[a]}–{DAYS[b]} {o}–{c}" for a, b, o, c in spans)


def clean(v: str) -> str:
    return v.strip().strip('"«»„“”').strip()


def point(f: dict, props: dict) -> dict:
    lon, lat = f["geometry"]["coordinates"]
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
            "properties": props}


def put(props: dict, key: str, value: str | None) -> None:
    value = clean(value or "")
    if value:
        props[key] = value


def load(name: str) -> list[dict]:
    return json.loads((MAP / name).read_text())["features"]


def osm(f: dict) -> list[dict]:
    p = f["properties"]
    category = OSM_CATEGORY.get(p["category"])
    if not category:  # department stores: other retailers are out of scope for the map
        return []
    props = {"id": f["id"], "c": category}
    if p["status"] not in ACTIVE:
        props["s"] = p["status"]
    for key, field in (("n", "name"), ("a", "address"), ("o", "operator"), ("b", "brand"), ("w", "website")):
        value = clean(p.get(field) or "")
        if value and not (key == "n" and value in PLACEHOLDER_NAMES):
            props[key] = value
    return [point(f, props)]


def avrora(f: dict) -> dict:
    p = f["properties"]
    props = {"id": p["id"], "c": "avrora", "n": f"Avrora #{p['shop_number']}"}
    put(props, "a", p["address"])
    put(props, "t", hours(p["note"]))  # opening hours from the store locator
    # the store-locator link is rebuilt from the id in the app, so it is not stored per point
    assert p["source_url"].endswith(f"store_location_id={p['shop_number']}"), p["id"]
    return point(f, props)


def food(f: dict) -> dict:
    p = f["properties"]
    props = {"id": p["id"].removeprefix("food-"), "c": "food", "r": p["role"]}
    if p["status"] not in ACTIVE:
        props["s"] = p["status"]
    if p["name"] != p["role"]:  # the export repeats the role when OSM has no name
        put(props, "n", p["name"])
    put(props, "a", p["address"])
    put(props, "o", p["operator"])
    return point(f, props)


def supply(f: dict) -> dict:
    p = f["properties"]
    # Avrora's own sites already say what they are in the name, so their kind line names the group instead
    role = {"avrora_logistics": "Avrora logistics", "historic_avrora": "Former Avrora site"}.get(p["group"], p["role"])
    props = {"id": p["id"], "c": "supply", "n": p["name"], "r": role}
    if p["status"] not in ACTIVE:
        props["s"] = p["status"]
    put(props, "a", p["address"])
    put(props, "t", p["note"])
    put(props, "u", p["source_url"])
    put(props, "l", p["source_label"])
    return point(f, props)


def main() -> None:
    out = [g for f in load("ukraine-locations.geojson") for g in osm(f)]
    out += [food(f) for f in load("food-infrastructure.geojson")]
    out += [avrora(f) for f in load("avrora-stores.geojson")]
    out += [supply(f) for f in load("supply-chain.geojson")]
    dst = MAP / "locations.min.json"
    dst.write_text(json.dumps({"type": "FeatureCollection", "features": out}, ensure_ascii=False, separators=(",", ":")))
    counts: dict[str, int] = {}
    for f in out:
        counts[f["properties"]["c"]] = counts.get(f["properties"]["c"], 0) + 1
    print(f"{len(out)} locations {counts}, {dst.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
