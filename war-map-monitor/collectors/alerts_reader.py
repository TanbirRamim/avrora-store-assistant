import os
import time
import random
import logging
from typing import Dict, Any, List, Optional
import httpx

from config import ALERTS_API_TOKEN, ALERTS_API_URL

logger = logging.getLogger(__name__)


class AlertsReader:
    """
    Reads real-time air raid alerts from alerts.in.ua.
    If no token is supplied, provides realistic live-simulated alert telemetry
    so the pipeline functions immediately for development and demonstration.
    """

    def __init__(self, api_token: Optional[str] = None):
        self.api_token = api_token or ALERTS_API_TOKEN
        self.last_fetch_time = 0
        self.cached_alerts: Dict[str, Any] = {}
        self.cache_duration_seconds = 15  # Real-time granularity

    def get_active_alerts(self, force_refresh: bool = False) -> Dict[str, Any]:
        """
        Returns structured dict of active alerts:
        {
          "is_simulated": bool,
          "fetched_at": str,
          "active_regions": List[str], # list of oblast names
          "active_hromadas": List[str], # list of hromada names
          "details": List[Dict]
        }
        """
        now = time.time()
        if self.cached_alerts and not force_refresh and (now - self.last_fetch_time < self.cache_duration_seconds):
            return self.cached_alerts

        # 1. Official alerts.in.ua API (if token provided)
        if self.api_token:
            try:
                data = self._fetch_live_api()
                self.cached_alerts = data
                self.last_fetch_time = now
                return data
            except Exception as e:
                logger.warning("Failed to fetch from live alerts.in.ua API: %s.", e)

        # 2. Public Live Ukrainian Civil Defense Alert Feed (100% Real-Time, No Key Required)
        try:
            data = self._fetch_ubilling_live()
            self.cached_alerts = data
            self.last_fetch_time = now
            return data
        except Exception as e:
            logger.warning("Failed to fetch from public live alerts feed: %s. Falling back to offline model.", e)

        # 3. Dynamic offline fallback (only if internet is disconnected)
        data = self._generate_simulated_alerts()
        self.cached_alerts = data
        self.last_fetch_time = now
        return data

    def _fetch_ubilling_live(self) -> Dict[str, Any]:
        """
        Fetches 100% real-time live air raid alert telemetry from the public
        Ukrainian civil defense alert feed without requiring an API key.
        """
        url = "https://ubilling.net.ua/aerialalerts/"
        with httpx.Client(timeout=8.0) as client:
            resp = client.get(url)
            resp.raise_for_status()
            data = resp.json()

        states = data.get("states", {})
        active_regions = []
        details = []

        for oblast_uk, alert_info in states.items():
            if alert_info.get("alertnow"):
                active_regions.append(oblast_uk)
                details.append({
                    "location_title": oblast_uk,
                    "location_type": "oblast",
                    "threat_type": "air_raid_siren",
                    "started_at": alert_info.get("changed", time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()))
                })

        return {
            "is_simulated": False,
            "source": f"Live State Feed ({data.get('source', 'Ukrainian Civil Defense Alert API')})",
            "fetched_at": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
            "cached_at": data.get("cachedat"),
            "active_regions": active_regions,
            "active_hromadas": [],
            "total_active_alerts": len(active_regions),
            "raw_alerts": details
        }

    def _fetch_live_api(self) -> Dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {self.api_token}",
            "User-Agent": "Avrora-Situational-Awareness/1.0"
        }
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(ALERTS_API_URL, headers=headers)
            resp.raise_for_status()
            raw = resp.json()

        active_alerts = raw.get("alerts", [])
        active_regions = set()
        active_hromadas = set()

        for a in active_alerts:
            loc_title = a.get("location_title", "")
            loc_type = a.get("location_type", "")
            
            if loc_type == "oblast":
                active_regions.add(loc_title)
            elif loc_type == "community" or loc_type == "hromada":
                active_hromadas.add(loc_title)

        return {
            "is_simulated": False,
            "fetched_at": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
            "active_regions": list(active_regions),
            "active_hromadas": list(active_hromadas),
            "total_active_alerts": len(active_alerts),
            "raw_alerts": active_alerts
        }

    def _generate_simulated_alerts(self) -> Dict[str, Any]:
        """
        Generates realistic wartime alert telemetry based on operational frontlines.
        Eastern/Southern regions (Donetsk, Kharkiv, Zaporizhzhia, Kherson) have high alert frequency;
        Central/Western regions have sporadic alarms.
        """
        # Baseline probability of active alarm right now by oblast
        oblast_probabilities = {
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

        active_regions = []
        active_hromadas = []
        details = []

        for oblast, prob in oblast_probabilities.items():
            if random.random() < prob:
                active_regions.append(oblast)
                details.append({
                    "location_title": oblast,
                    "location_type": "oblast",
                    "threat_type": random.choice(["tactical_aviation", "ballistics", "shahed_drone", "artillery"]),
                    "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - random.randint(120, 3600)))
                })

        # Add specific active frontline hromadas
        frontline_hromadas = [
            "Покровська міська громада",
            "Краматорська міська громада",
            "Нікопольська міська громада",
            "Херсонська міська громада"
        ]
        for h in frontline_hromadas:
            if random.random() < 0.85:
                active_hromadas.append(h)
                details.append({
                    "location_title": h,
                    "location_type": "hromada",
                    "threat_type": "artillery_and_fpv",
                    "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                })

        return {
            "is_simulated": True,
            "notice": "Simulated live feed. Set ALERTS_IN_UA_TOKEN in .env to bind official live alerts.",
            "fetched_at": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
            "active_regions": active_regions,
            "active_hromadas": active_hromadas,
            "total_active_alerts": len(details),
            "raw_alerts": details
        }
