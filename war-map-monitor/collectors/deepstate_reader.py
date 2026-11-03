import json
import logging
import time
from pathlib import Path
from typing import List, Tuple

import httpx

from config import DATA_DIR, DEEPSTATE_GEOJSON_MIRRORS


logger = logging.getLogger(__name__)

CACHE_FILE = DATA_DIR / "cached_frontline.geojson"
CACHE_META_FILE = DATA_DIR / "cached_frontline.meta.json"
SAMPLE_FILE = DATA_DIR / "sample_frontline.geojson"
CACHE_TTL_HOURS = 2


class DeepStateReader:
    """Load a current contact line, with explicit cache/sample provenance."""

    def __init__(self, force_refresh: bool = False):
        self.force_refresh = force_refresh
        self.frontline_coords: List[Tuple[float, float]] = []
        self.source_metadata = {
            "source": "unknown",
            "last_updated": None,
            "total_nodes": 0,
            "is_fallback": True,
            "geometry_mode": "unknown",
        }

    def get_frontline_points(self) -> List[Tuple[float, float]]:
        if self.frontline_coords and not self.force_refresh:
            return self.frontline_coords
        geojson_data = self._load_geojson()
        self.frontline_coords, geometry_mode = self._extract_line_points(geojson_data)
        self.source_metadata["total_nodes"] = len(self.frontline_coords)
        self.source_metadata["geometry_mode"] = geometry_mode
        if not self.frontline_coords:
            raise ValueError("Frontline source contained no usable line coordinates")
        return self.frontline_coords

    def _is_cache_valid(self) -> bool:
        return CACHE_FILE.exists() and time.time() - CACHE_FILE.stat().st_mtime < CACHE_TTL_HOURS * 3600

    def _read_cache(self, stale: bool = False) -> dict:
        data = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        metadata = {}
        if CACHE_META_FILE.exists():
            try:
                metadata = json.loads(CACHE_META_FILE.read_text(encoding="utf-8"))
            except Exception:
                metadata = {}
        self.source_metadata.update(
            {
                "source": metadata.get("source", "stale_local_cache" if stale else "local_cache"),
                "last_updated": metadata.get("last_updated", time.ctime(CACHE_FILE.stat().st_mtime)),
                "is_fallback": stale,
            }
        )
        return data

    def _load_geojson(self) -> dict:
        if self._is_cache_valid() and not self.force_refresh:
            try:
                return self._read_cache(stale=False)
            except Exception as exc:
                logger.warning("Failed reading current frontline cache: %s", exc)

        errors = []
        for url in DEEPSTATE_GEOJSON_MIRRORS:
            try:
                with httpx.Client(timeout=25.0, follow_redirects=True) as client:
                    response = client.get(url, headers={"User-Agent": "Avrora-Situational-Awareness/2.0"})
                    response.raise_for_status()
                    data = response.json()
                if data.get("type") != "FeatureCollection" or not data.get("features"):
                    raise ValueError("not a non-empty GeoJSON FeatureCollection")
                points, _ = self._extract_line_points(data)
                if not points:
                    raise ValueError("no line or contact-line geometry")
                updated = (
                    data.get("properties", {}).get("generated")
                    or data.get("properties", {}).get("data_date")
                    or response.headers.get("last-modified")
                    or time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime())
                )
                CACHE_FILE.write_text(json.dumps(data), encoding="utf-8")
                CACHE_META_FILE.write_text(
                    json.dumps({"source": url, "last_updated": updated}, indent=2), encoding="utf-8"
                )
                self.source_metadata.update({"source": url, "last_updated": updated, "is_fallback": False})
                return data
            except Exception as exc:
                errors.append(f"{url}: {exc}")
                logger.warning("Frontline source failed (%s): %s", url, exc)

        if CACHE_FILE.exists():
            logger.warning("All live frontline sources failed; using stale cache. Errors: %s", " | ".join(errors))
            try:
                return self._read_cache(stale=True)
            except Exception:
                pass

        if SAMPLE_FILE.exists():
            self.source_metadata.update(
                {
                    "source": "baked_sample",
                    "last_updated": time.ctime(SAMPLE_FILE.stat().st_mtime),
                    "is_fallback": True,
                }
            )
            logger.error("All live frontline sources failed; using baked sample. Errors: %s", " | ".join(errors))
            return json.loads(SAMPLE_FILE.read_text(encoding="utf-8"))

        raise FileNotFoundError("No live frontline, cache, or sample data could be loaded")

    @staticmethod
    def _coordinate_pairs(geometry: dict):
        geometry_type = geometry.get("type", "")
        coordinates = geometry.get("coordinates", [])
        if geometry_type == "LineString":
            yield from coordinates
        elif geometry_type == "MultiLineString":
            for line in coordinates:
                yield from line
        elif geometry_type == "Polygon":
            if coordinates:
                yield from coordinates[0]
        elif geometry_type == "MultiPolygon":
            for polygon in coordinates:
                if polygon:
                    yield from polygon[0]

    def _extract_line_points(self, geojson_data: dict):
        features = geojson_data.get("features", [])
        explicit_contact = [
            feature for feature in features if feature.get("properties", {}).get("kind") == "contact_line"
        ]
        line_features = [
            feature
            for feature in features
            if feature.get("geometry", {}).get("type") in {"LineString", "MultiLineString"}
        ]
        selected = explicit_contact or line_features or features
        geometry_mode = "contact_line" if explicit_contact else "line" if line_features else "derived_polygon_boundary"
        points = []
        for feature in selected:
            for coordinate in self._coordinate_pairs(feature.get("geometry", {})):
                if isinstance(coordinate, list) and len(coordinate) >= 2:
                    points.append((coordinate[1], coordinate[0]))
        return points, geometry_mode
