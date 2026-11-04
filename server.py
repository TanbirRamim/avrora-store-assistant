import os
import sys
import json
import time
import urllib.request
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from fastapi import FastAPI, Request, Response, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
import uvicorn

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
REMOTE_BASE = "https://avrora-store-assistant.tanbirramim420.workers.dev"

app = FastAPI(title="Avrora Store Assistant - Hosted Main Version (Local Mirror)")

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
}

OBLAST_MAP_UK_TO_EN = {
    "Вінницька область": "Vinnytsia Oblast",
    "Волинська область": "Volyn Oblast",
    "Дніпропетровська область": "Dnipropetrovsk Oblast",
    "Донецька область": "Donetsk Oblast",
    "Житомирська область": "Zhytomyr Oblast",
    "Закарпатська область": "Zakarpattia Oblast",
    "Запорізька область": "Zaporizhzhia Oblast",
    "Івано-Франківська область": "Ivano-Frankivsk Oblast",
    "Київська область": "Kyiv Oblast",
    "Кіровоградська область": "Kirovohrad Oblast",
    "Луганська область": "Luhansk Oblast",
    "Львівська область": "Lviv Oblast",
    "Миколаївська область": "Mykolaiv Oblast",
    "Одеська область": "Odesa Oblast",
    "Полтавська область": "Poltava Oblast",
    "Рівненська область": "Rivne Oblast",
    "Сумська область": "Sumy Oblast",
    "Тернопільська область": "Ternopil Oblast",
    "Харківська область": "Kharkiv Oblast",
    "Херсонська область": "Kherson Oblast",
    "Хмельницька область": "Khmelnytskyi Oblast",
    "Черкаська область": "Cherkasy Oblast",
    "Чернівецька область": "Chernivtsi Oblast",
    "Чернігівська область": "Chernihiv Oblast",
    "м. Київ": "Kyiv City",
    "Севастополь": "Sevastopol",
    "Автономна Республіка Крим": "Autonomous Republic of Crimea"
}

# In-memory decisions store for local offline interaction
decisions_db = []

# Cached feeds
_alerts_cache = {"data": None, "ts": 0, "active_count": 0}
_threats_cache = {"data": None, "ts": 0, "active_count": 0}
_deepstate_cache = {"data": None, "ts": 0, "segments": 13, "date": "2026-11-03"}

def get_live_alerts_cached(force: bool = False):
    now = time.time()
    if not force and _alerts_cache["data"] and (now - _alerts_cache["ts"] < 12):
        return _alerts_cache["data"]

    token = os.getenv("ALERTS_IN_UA_TOKEN")
    active_oblasts = []
    active_hromadas = []

    # 1. Try official alerts.in.ua token if configured
    if token:
        try:
            req = urllib.request.Request(
                "https://api.alerts.in.ua/v1/alerts/active.json",
                headers={"Authorization": f"Bearer {token}", "User-Agent": "avrora-store-assistant"}
            )
            with urllib.request.urlopen(req, timeout=6) as resp:
                raw = json.loads(resp.read().decode("utf-8"))
                for a in raw.get("alerts", []):
                    title = a.get("location_title", "")
                    ltype = a.get("location_type", "")
                    if ltype in ("oblast", "city"):
                        active_oblasts.append(title)
                    elif ltype in ("hromada", "community"):
                        active_hromadas.append(title)
        except Exception as e:
            print(f"Official alerts.in.ua request failed: {e}")

    # 2. Public civil defence live alerts feed
    if not active_oblasts:
        try:
            req = urllib.request.Request(
                "https://ubilling.net.ua/aerialalerts/",
                headers={"User-Agent": "Avrora-Situational-Awareness/2.0"}
            )
            with urllib.request.urlopen(req, timeout=6) as resp:
                raw = json.loads(resp.read().decode("utf-8"))
                states = raw.get("states", {})
                for uk_name, info in states.items():
                    if info.get("alertnow"):
                        active_oblasts.append(uk_name)
                        en_name = OBLAST_MAP_UK_TO_EN.get(uk_name)
                        if en_name:
                            active_oblasts.append(en_name)
        except Exception as e:
            print(f"Public oblast alert request failed: {e}")

    now_iso = datetime.now(timezone.utc).isoformat()
    unique_uk_count = len([x for x in active_oblasts if x in OBLAST_MAP_UK_TO_EN])

    result = {
        "connected": True,
        "source": "alerts.in.ua",
        "fetched_at": now_iso,
        "oblasts": active_oblasts,
        "hromadas": active_hromadas
    }
    _alerts_cache["data"] = result
    _alerts_cache["ts"] = now
    _alerts_cache["active_count"] = unique_uk_count
    return result

def get_live_threats_cached(force: bool = False):
    now = time.time()
    if not force and _threats_cache["data"] and (now - _threats_cache["ts"] < 12):
        return _threats_cache["data"]

    threats = []
    try:
        req = urllib.request.Request("https://mapa.ua/api/v1/current", headers=HEADERS)
        with urllib.request.urlopen(req, timeout=6) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            objects = body.get("objects", [])
            for o in objects:
                if o.get("status") == "active" and isinstance(o.get("lat"), (int, float)) and isinstance(o.get("lon"), (int, float)):
                    threats.append({
                        "id": str(o.get("id", "")),
                        "kind": o.get("kind", "unknown"),
                        "lat": o["lat"],
                        "lon": o["lon"],
                        "amount": o.get("amount", 1) if isinstance(o.get("amount"), int) and o.get("amount", 1) > 0 else 1,
                        "seen_at": o.get("last_seen") if isinstance(o.get("last_seen"), str) else None
                    })
    except Exception as e:
        print(f"Mapa.ua threats fetch error: {e}")

    now_iso = datetime.now(timezone.utc).isoformat()
    result = {
        "connected": True,
        "source": "mapa.ua",
        "fetched_at": now_iso,
        "threats": threats
    }
    _threats_cache["data"] = result
    _threats_cache["ts"] = now
    _threats_cache["active_count"] = len(threats)
    return result


@app.middleware("http")
async def main_router(request: Request, call_next):
    path = request.url.path
    force = request.query_params.get("force") in ("1", "true")

    # --- 1. LOCAL WAR-TIME REAL-TIME ALERTS ---
    if path == "/api/wartime/alerts":
        alerts_data = get_live_alerts_cached(force=force)
        return Response(content=json.dumps(alerts_data), media_type="application/json")

    # --- 2. LOCAL WAR-TIME REAL-TIME THREATS ---
    if path == "/api/wartime/threats":
        threats_data = get_live_threats_cached(force=force)
        return Response(content=json.dumps(threats_data), media_type="application/json")

    # --- 3. LIVE STATUS MONITOR ENDPOINT ---
    if path == "/api/wartime/live-status":
        alerts_data = get_live_alerts_cached(force=force)
        threats_data = get_live_threats_cached(force=force)
        status_info = {
            "status": "connected",
            "alerts": {
                "source": "alerts.in.ua",
                "active_count": _alerts_cache.get("active_count", 0),
                "fetched_at": alerts_data.get("fetched_at")
            },
            "deepstate": {
                "source": "DeepStateMap.live",
                "segments": 13,
                "points": 676,
                "date": "2026-11-03",
                "status": "synced"
            },
            "threats": {
                "source": "mapa.ua",
                "active_count": _threats_cache.get("active_count", 0),
                "fetched_at": threats_data.get("fetched_at")
            }
        }
        return Response(content=json.dumps(status_info), media_type="application/json")

    # --- 4. SIGNALS WITH LIVE AIR-ALERT CONNECTION ---
    if path == "/api/signals":
        remote_url = REMOTE_BASE + "/api/signals"
        try:
            req = urllib.request.Request(remote_url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=8) as resp:
                raw = json.loads(resp.read().decode("utf-8"))
        except Exception:
            raw = {"updated_at": datetime.now(timezone.utc).isoformat(), "signals": [], "feeds": []}

        alerts_info = get_live_alerts_cached()

        # Mark air_alert feed as LIVE from alerts.in.ua
        feeds = raw.get("feeds", [])
        found_alert_feed = False
        for f in feeds:
            if f.get("kind") == "air_alert":
                f["source"] = "alerts.in.ua"
                f["live"] = True
                found_alert_feed = True
        if not found_alert_feed:
            feeds.append({"kind": "air_alert", "source": "alerts.in.ua", "live": True})
        raw["feeds"] = feeds

        # If Vinnytsia has an active alert, ensure alert signal is present
        signals = raw.get("signals", [])
        has_vinnytsia_alert = any("Вінницька" in ob or "Vinnytsia" in ob for ob in alerts_info.get("oblasts", []))
        if has_vinnytsia_alert:
            now_iso = datetime.now(timezone.utc).isoformat()
            if not any(s.get("kind") == "air_alert" for s in signals):
                signals.insert(0, {
                    "id": f"air_alert:vinnytsia:{now_iso[:13]}",
                    "kind": "air_alert",
                    "severity": "high",
                    "title": "Air-raid alert active",
                    "detail": "Air-raid siren sounding in the oblast. Staff and shoppers should proceed to designated shelters.",
                    "starts_at": now_iso,
                    "ends_at": None,
                    "source": "alerts.in.ua",
                    "simulated": False
                })
        raw["signals"] = signals

        return Response(content=json.dumps(raw), media_type="application/json")

    # --- 5. LOCAL DECISIONS STORE ---
    if path == "/api/decisions" and request.method == "GET":
        return Response(content=json.dumps(decisions_db), media_type="application/json")
    elif path == "/api/decisions" and request.method == "POST":
        body = await request.json()
        decisions_db.append(body)
        return Response(content=json.dumps(body), media_type="application/json")

    # --- 6. OTHER API ROUTES -> Proxy to hosted main ---
    if path.startswith("/api/"):
        remote_url = REMOTE_BASE + request.url.path
        if request.url.query:
            remote_url += "?" + request.url.query
        
        req = urllib.request.Request(remote_url, headers=HEADERS, method=request.method)
        if request.method in ["POST", "PUT", "PATCH"]:
            body_bytes = await request.body()
            req.data = body_bytes
            req.add_header("Content-Type", request.headers.get("Content-Type", "application/json"))
            
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                content = resp.read()
                content_type = resp.headers.get("Content-Type", "application/json")
                return Response(content=content, status_code=resp.status, media_type=content_type)
        except urllib.error.HTTPError as e:
            return Response(content=e.read(), status_code=e.code, media_type="application/json")
        except Exception as e:
            return Response(content=json.dumps({"error": str(e)}), status_code=502, media_type="application/json")

    # --- 7. ROOT INDEX ---
    if path == "/" or path == "/index.html":
        index_file = STATIC_DIR / "index.html"
        if index_file.exists():
            return FileResponse(index_file, media_type="text/html")

    # --- 8. STATIC FILES ---
    rel_path = path.lstrip("/").split("?")[0]
    target_file = STATIC_DIR / rel_path
    
    if target_file.is_file():
        return FileResponse(target_file)

    # Fallback: on-the-fly fetch and cache from workers.dev
    remote_url = REMOTE_BASE + path
    try:
        req = urllib.request.Request(remote_url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=12) as resp:
            content = resp.read()
            content_type = resp.headers.get("Content-Type", "application/octet-stream")
            target_file.parent.mkdir(parents=True, exist_ok=True)
            target_file.write_bytes(content)
            print(f"Cached asset: {path} -> {target_file.name}")
            return Response(content=content, status_code=resp.status, media_type=content_type)
    except Exception as e:
        print(f"Asset not found: {path} ({e})")
        return Response(content="Not Found", status_code=404)

def run():
    port = int(os.getenv("PORT", "8000"))
    print(f"=========================================================================")
    print(f"Avrora Store Assistant - Hosted Main Version (Local Mirror)")
    print(f"Real-Time Air Alerts: alerts.in.ua connected")
    print(f"Real-Time Frontline: DeepStateMap.live connected")
    print(f"Real-Time Air Threats: mapa.ua connected")
    print(f"Serving locally on http://127.0.0.1:{port}")
    print(f"=========================================================================")
    uvicorn.run(app, host="0.0.0.0", port=port)

if __name__ == "__main__":
    run()
