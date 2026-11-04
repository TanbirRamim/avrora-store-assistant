import logging
import os
import random
import time
from typing import Any, Dict, Optional

import httpx

from config import ALERTS_API_TOKEN, ALERTS_API_URL


logger = logging.getLogger(__name__)
PUBLIC_OBLAST_FEED = "https://ubilling.net.ua/aerialalerts/"


class AlertsReader:
    """Read official alerts when configured, otherwise a public oblast feed."""

    def __init__(self, api_token: Optional[str] = None):
        self.api_token = api_token or ALERTS_API_TOKEN
        self.last_fetch_time = 0
        self.cached_alerts: Dict[str, Any] = {}
        self.cache_duration_seconds = 15

    def get_active_alerts(self, force_refresh: bool = False) -> Dict[str, Any]:
        now = time.time()
        if self.cached_alerts and not force_refresh and now - self.last_fetch_time < self.cache_duration_seconds:
            return self.cached_alerts

        errors = []
        if self.api_token:
            try:
                return self._remember(self._fetch_official_api())
            except Exception as exc:
                errors.append(f"official API: {exc}")
                logger.warning("Official alerts.in.ua request failed: %s", exc)

        try:
            return self._remember(self._fetch_public_oblast_feed())
        except Exception as exc:
            errors.append(f"public oblast feed: {exc}")
            logger.warning("Public oblast alert request failed: %s", exc)

        if os.getenv("MONITOR_ALLOW_SIMULATION", "").strip().lower() in {"1", "true", "yes"}:
            data = self._generate_simulated_alerts()
        else:
            data = self._unavailable_alerts()
        data["source_errors"] = errors
        return self._remember(data)

    def _remember(self, data: Dict[str, Any]):
        self.cached_alerts = data
        self.last_fetch_time = time.time()
        return data

    def _fetch_public_oblast_feed(self) -> Dict[str, Any]:
        with httpx.Client(timeout=10.0, follow_redirects=True) as client:
            response = client.get(PUBLIC_OBLAST_FEED, headers={"User-Agent": "Avrora-Situational-Awareness/2.0"})
            response.raise_for_status()
            raw = response.json()
        states = raw.get("states")
        if not isinstance(states, dict) or len(states) < 20:
            raise ValueError("public feed did not return the full oblast table")
        active_regions = []
        details = []
        for oblast_uk, alert_info in states.items():
            if bool(alert_info.get("alertnow")):
                active_regions.append(oblast_uk)
                details.append(
                    {
                        "location_title": oblast_uk,
                        "location_type": "oblast",
                        "threat_type": "air_raid_siren",
                        "started_at": alert_info.get("changed"),
                    }
                )
        return {
            "is_simulated": False,
            "source": f"Public oblast alert feed ({raw.get('source', 'Ukraine civil defence')})",
            "coverage": "oblast_only",
            "fetched_at": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
            "data_timestamp": raw.get("cachedat"),
            "active_regions": active_regions,
            "active_hromadas": [],
            "total_active_alerts": len(active_regions),
            "raw_alerts": details,
        }

    def _fetch_official_api(self) -> Dict[str, Any]:
        headers = {"Authorization": f"Bearer {self.api_token}", "User-Agent": "Avrora-Situational-Awareness/2.0"}
        with httpx.Client(timeout=12.0, follow_redirects=True) as client:
            response = client.get(ALERTS_API_URL, headers=headers)
            response.raise_for_status()
            raw = response.json()
        active_alerts = raw.get("alerts", [])
        if not isinstance(active_alerts, list):
            raise ValueError("official API returned an unexpected payload")
        active_regions = set()
        active_hromadas = set()
        for alert in active_alerts:
            location = alert.get("location_title", "")
            location_type = alert.get("location_type", "")
            if location_type == "oblast":
                active_regions.add(location)
            elif location_type in {"community", "hromada"}:
                active_hromadas.add(location)
        return {
            "is_simulated": False,
            "source": "alerts.in.ua official API",
            "coverage": "oblast_and_hromada",
            "fetched_at": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
            "data_timestamp": None,
            "active_regions": sorted(active_regions),
            "active_hromadas": sorted(active_hromadas),
            "total_active_alerts": len(active_alerts),
            "raw_alerts": active_alerts,
        }

    def _unavailable_alerts(self) -> Dict[str, Any]:
        """No live data: report that explicitly instead of inventing alerts."""
        return {
            "is_simulated": False,
            "available": False,
            "source": "unavailable",
            "coverage": "none",
            "notice": "Alert feeds unavailable: alert status is UNKNOWN, an empty alert list is not an all-clear.",
            "fetched_at": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
            "data_timestamp": None,
            "active_regions": [],
            "active_hromadas": [],
            "total_active_alerts": 0,
            "raw_alerts": [],
        }

    def _generate_simulated_alerts(self) -> Dict[str, Any]:
        probabilities = {
            "Донецька область": 0.90,
            "Харківська область": 0.75,
            "Запорізька область": 0.70,
            "Херсонська область": 0.80,
            "Дніпропетровська область": 0.45,
            "Полтавська область": 0.30,
            "м. Київ": 0.25,
            "Одеська область": 0.35,
            "Львівська область": 0.10,
        }
        active_regions = [oblast for oblast, probability in probabilities.items() if random.random() < probability]
        return {
            "is_simulated": True,
            "source": "offline simulation",
            "coverage": "simulation",
            "notice": "Not live: official and public alert sources are unavailable.",
            "fetched_at": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
            "data_timestamp": None,
            "active_regions": active_regions,
            "active_hromadas": [],
            "total_active_alerts": len(active_regions),
            "raw_alerts": [],
        }
