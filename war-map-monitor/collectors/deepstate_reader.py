import os
import json
import time
import logging
from pathlib import Path
from typing import List, Tuple, Optional
import httpx

from config import DATA_DIR, DEEPSTATE_GEOJSON_MIRRORS

logger = logging.getLogger(__name__)

CACHE_FILE = DATA_DIR / "cached_frontline.geojson"
SAMPLE_FILE = DATA_DIR / "sample_frontline.geojson"
CACHE_TTL_HOURS = 2


class DeepStateReader:
    """
    Reads and extracts frontline and conflict boundaries from DeepStateMap sources.
    Uses multi-tier fallback: Live Mirror -> Local Cache -> Baked Sample GeoJSON.
    """

    def __init__(self, force_refresh: bool = False):
        self.force_refresh = force_refresh
        self.frontline_coords: List[Tuple[float, float]] = [] # [(lat, lon), ...]
        self.source_metadata = {
            "source": "unknown",
            "last_updated": None,
            "total_nodes": 0
        }

    def get_frontline_points(self) -> List[Tuple[float, float]]:
        """
        Returns list of (latitude, longitude) coordinates representing the Line of Contact.
        """
        if self.frontline_coords and not self.force_refresh:
            return self.frontline_coords

        geojson_data = self._load_geojson()
        self.frontline_coords = self._extract_line_points(geojson_data)
        self.source_metadata["total_nodes"] = len(self.frontline_coords)
        return self.frontline_coords

    def _is_cache_valid(self) -> bool:
        if not CACHE_FILE.exists():
            return False
        age_seconds = time.time() - CACHE_FILE.stat().st_mtime
        return age_seconds < (CACHE_TTL_HOURS * 3600)

    def _load_geojson(self) -> dict:
        # 1. Check local cache if fresh and not force-refreshing
        if self._is_cache_valid() and not self.force_refresh:
            try:
                with open(CACHE_FILE, "r", encoding="utf-8") as f:
                    logger.info("Loaded frontline from local cache (%s)", CACHE_FILE)
                    self.source_metadata["source"] = "local_cache"
                    self.source_metadata["last_updated"] = time.ctime(CACHE_FILE.stat().st_mtime)
                    return json.load(f)
            except Exception as e:
                logger.warning("Failed reading cache: %s", e)

        # 2. Try fetching from online mirrors
        for url in DEEPSTATE_GEOJSON_MIRRORS:
            try:
                logger.info("Attempting to fetch DeepState GeoJSON from: %s", url)
                with httpx.Client(timeout=15.0, follow_redirects=True) as client:
                    resp = client.get(url, headers={"User-Agent": "Avrora-Situational-Awareness/1.0"})
                    if resp.status_code == 200:
                        data = resp.json()
                        # Save to cache
                        with open(CACHE_FILE, "w", encoding="utf-8") as f:
                            json.dump(data, f)
                        self.source_metadata["source"] = url
                        self.source_metadata["last_updated"] = time.ctime()
                        logger.info("Successfully fetched live DeepState data and cached.")
                        return data
            except Exception as e:
                logger.warning("Mirror %s failed: %s", url, e)

        # 3. Fallback to cached file even if older
        if CACHE_FILE.exists():
            try:
                with open(CACHE_FILE, "r", encoding="utf-8") as f:
                    self.source_metadata["source"] = "stale_local_cache"
                    self.source_metadata["last_updated"] = time.ctime(CACHE_FILE.stat().st_mtime)
                    return json.load(f)
            except Exception:
                pass

        # 4. Fallback to baked sample frontline
        if SAMPLE_FILE.exists():
            logger.info("Falling back to baseline sample frontline (%s)", SAMPLE_FILE)
            with open(SAMPLE_FILE, "r", encoding="utf-8") as f:
                self.source_metadata["source"] = "baked_sample"
                self.source_metadata["last_updated"] = time.ctime(SAMPLE_FILE.stat().st_mtime)
                return json.load(f)

        raise FileNotFoundError("Could not obtain frontline data from online mirrors, cache, or sample file.")

    def _extract_line_points(self, geojson_data: dict) -> List[Tuple[float, float]]:
        """
        Extracts coordinate vertices (lat, lon) from LineString, MultiLineString,
        and polygon boundaries in GeoJSON.
        """
        points = []
        features = geojson_data.get("features", [])

        for feature in features:
            geom = feature.get("geometry", {})
            gtype = geom.get("type", "")
            coords = geom.get("coordinates", [])

            if gtype == "LineString":
                for c in coords:
                    # GeoJSON is [lon, lat] -> store as (lat, lon)
                    points.append((c[1], c[0]))
            elif gtype == "MultiLineString":
                for line in coords:
                    for c in line:
                        points.append((c[1], c[0]))
            elif gtype == "Polygon":
                # Outer ring of polygon
                if coords:
                    for c in coords[0]:
                        points.append((c[1], c[0]))
            elif gtype == "MultiPolygon":
                for poly in coords:
                    if poly:
                        for c in poly[0]:
                            points.append((c[1], c[0]))

        return points
