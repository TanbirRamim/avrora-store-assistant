import os
import json
from typing import Optional
from fastapi import FastAPI, Query, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from config import CSV_OUTPUT_PATH, JSON_OUTPUT_PATH, METRICS_OUTPUT_PATH
from engine.orchestrator import WarMapOrchestrator

app = FastAPI(
    title="Avrora Store Alert Map",
    description="Real-time alerts.in.ua-style situation map for Avrora store managers across Ukraine",
    version="3.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

orchestrator = WarMapOrchestrator()


@app.on_event("startup")
def startup_event():
    orchestrator.process_cycle()


@app.get("/api/summary")
def get_summary():
    """Returns chain-wide threat metrics summary."""
    if METRICS_OUTPUT_PATH.exists():
        with open(METRICS_OUTPUT_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    _, summary = orchestrator.process_cycle()
    return summary


@app.get("/api/datasheet")
def get_datasheet(
    zone: Optional[str] = Query(None, description="Filter by threat zone: RED, ORANGE, YELLOW, GREEN"),
    alarm_only: bool = Query(False, description="Filter stores under active siren only"),
    city: Optional[str] = Query(None, description="Filter by city name")
):
    """Returns real-time store alert telemetry."""
    if JSON_OUTPUT_PATH.exists():
        with open(JSON_OUTPUT_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    else:
        data, _ = orchestrator.process_cycle()

    filtered = data
    if zone:
        filtered = [r for r in filtered if r.get("threat_zone", "").upper() == zone.upper()]
    if alarm_only:
        filtered = [r for r in filtered if r.get("alert_status") != "CLEAR"]
    if city:
        filtered = [r for r in filtered if city.lower() in r.get("city", "").lower()]

    return filtered


@app.post("/api/stores/{store_id}/acknowledge")
def acknowledge_shelter(store_id: str):
    """Store Manager shelter evacuation acknowledgment loop."""
    ack = orchestrator.acknowledge_shelter(store_id)
    orchestrator.process_cycle()
    return {"status": "success", "store_id": store_id, "ack": ack}


@app.post("/api/stores/{store_id}/reset-ack")
def reset_shelter_ack(store_id: str):
    """Resets acknowledgment back to unconfirmed."""
    orchestrator.reset_shelter_ack(store_id)
    orchestrator.process_cycle()
    return {"status": "success", "store_id": store_id}


@app.get("/api/datasheet/csv")
def download_csv():
    """Direct download of current CSV datasheet."""
    if not CSV_OUTPUT_PATH.exists():
        orchestrator.process_cycle()
    return FileResponse(
        path=CSV_OUTPUT_PATH,
        filename="avrora_war_threat_sheet.csv",
        media_type="text/csv"
    )


@app.post("/api/refresh")
def force_refresh():
    """Forces an immediate synchronization cycle."""
    rows, summary = orchestrator.process_cycle(force_refresh_maps=True)
    return {
        "status": "success",
        "message": "Data sheet synchronized",
        "summary": summary
    }


@app.get("/api/border")
def get_ukraine_border():
    """Returns official internationally recognized border of Ukraine (including Crimea and all oblasts)."""
    border_path = os.path.join(os.path.dirname(__file__), "data", "ukraine_border.geojson")
    if os.path.exists(border_path):
        with open(border_path, "r", encoding="utf-8") as f:
            return json.load(f)
    raise HTTPException(status_code=404, detail="Ukraine border GeoJSON file not found")


@app.get("/api/frontline")
def get_frontline_coords():
    """Returns the line-of-contact coordinates."""
    pts = orchestrator.deepstate_reader.get_frontline_points()
    return [{"lat": p[0], "lon": p[1]} for p in pts]


@app.get("/", response_class=HTMLResponse)
def get_alerts_map_html():
    """
    Alerts.in.ua-style Real-Time Situation Map for Avrora stores.
    Displays store locations across Ukraine as interactive glowing markers,
    with slide-out inspection cards for life-safety directives and shelter proximity.
    """
    return r"""<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Avrora Store Alert Map · Alerts.in.ua Style</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    :root {
      --bg-dark: #070d19;
      --card-dark: #0f172a;
      --border-dark: #1e293b;
      --alert-red: #ef4444;
      --warning-amber: #f59e0b;
      --safe-green: #10b981;
    }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; padding: 0; background-color: var(--bg-dark); color: #f8fafc; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; overflow: hidden; }
    
    #map { width: 100%; height: 100%; position: absolute; inset: 0; z-index: 1; }
    
    /* Basemap styling */
    .leaflet-container { background: #070d19; }
    
    /* OpenStreetMap Tactical Dark inversion filter */
    .osm-dark-tiles {
      filter: invert(100%) hue-rotate(180deg) brightness(85%) contrast(110%);
    }

    /* Radar-Style Store Pins */
    @keyframes radar-pulse-red {
      0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.95); transform: scale(1); }
      70% { box-shadow: 0 0 0 16px rgba(239, 68, 68, 0); transform: scale(1.1); }
      100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); transform: scale(1); }
    }
    @keyframes amber-pulse {
      0%, 100% { box-shadow: 0 0 6px rgba(245, 158, 11, 0.6); }
      50% { box-shadow: 0 0 14px rgba(245, 158, 11, 0.9); }
    }

    .custom-pin-wrapper {
      background: transparent !important;
      border: none !important;
    }

    .pin-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      cursor: pointer;
    }

    .store-marker-pin {
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 9999px;
      font-weight: 800;
      transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s;
    }
    .pin-container:hover .store-marker-pin {
      transform: scale(1.25) !important;
    }

    .pin-selected {
      outline: 3px solid #facc15 !important;
      outline-offset: 3px !important;
      transform: scale(1.25) !important;
      z-index: 9999 !important;
    }

    .pin-siren {
      background: linear-gradient(135deg, #ef4444, #b91c1c);
      color: #ffffff;
      border: 2px solid #ffffff;
      animation: radar-pulse-red 1.6s infinite ease-in-out;
      box-shadow: 0 0 18px rgba(239, 68, 68, 0.85);
    }
    .pin-frontline-red {
      background: linear-gradient(135deg, #ea580c, #c2410c);
      color: #ffffff;
      border: 2px solid #ffffff;
      animation: amber-pulse 2s infinite ease-in-out;
      box-shadow: 0 0 12px rgba(234, 88, 12, 0.7);
    }
    .pin-amber {
      background: linear-gradient(135deg, #f59e0b, #d97706);
      color: #ffffff;
      border: 1.5px solid #ffffff;
      box-shadow: 0 0 8px rgba(245, 158, 11, 0.6);
    }
    .pin-green {
      background: linear-gradient(135deg, #10b981, #047857);
      color: #ffffff;
      border: 1.5px solid #ffffff;
      box-shadow: 0 0 6px rgba(16, 185, 129, 0.5);
    }

    .pin-label {
      font-size: 10px;
      font-weight: 700;
      color: #f1f5f9;
      background: rgba(15, 23, 42, 0.88);
      backdrop-filter: blur(4px);
      padding: 1px 5px;
      border-radius: 4px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      white-space: nowrap;
      margin-top: 3px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.6);
      pointer-events: none;
      letter-spacing: 0.02em;
    }

    /* Floating Quick Store Bar at the bottom */
    .store-quick-bar {
      position: absolute;
      bottom: 24px;
      left: 275px;
      right: 120px;
      z-index: 1000;
      display: flex;
      gap: 6px;
      overflow-x: auto;
      padding: 6px 4px;
      scrollbar-width: none;
    }
    .store-quick-bar::-webkit-scrollbar { display: none; }
    .store-pill {
      flex-shrink: 0;
      background: rgba(15, 23, 42, 0.92);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 9999px;
      padding: 5px 12px;
      font-size: 11px;
      font-weight: 600;
      color: #e2e8f0;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.18s ease;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    .store-pill:hover, .store-pill.active {
      background: rgba(30, 41, 59, 0.98);
      border-color: #facc15;
      transform: translateY(-2px);
      color: #ffffff;
    }

    /* Floating Header bar */
    .top-header {
      position: absolute;
      top: 16px;
      left: 16px;
      z-index: 1000;
      background: rgba(15, 23, 42, 0.94);
      backdrop-filter: blur(14px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 14px;
      padding: 8px 16px;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.55);
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .filter-btn {
      padding: 4px 9px;
      border-radius: 8px;
      font-size: 11px;
      font-weight: 600;
      color: #94a3b8;
      background: rgba(30, 41, 59, 0.6);
      border: 1px solid transparent;
      transition: all 0.18s ease;
      cursor: pointer;
    }
    .filter-btn:hover {
      color: #f8fafc;
      background: rgba(51, 65, 85, 0.8);
    }
    .filter-btn.active {
      color: #ffffff;
      background: rgba(51, 65, 85, 0.95);
      border-color: rgba(255, 255, 255, 0.2);
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }

    /* Floating Legend & Filters */
    .legend-panel {
      position: absolute;
      bottom: 24px;
      left: 16px;
      z-index: 1000;
      background: rgba(15, 23, 42, 0.92);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 10px 14px;
      font-size: 11px;
      box-shadow: 0 12px 28px rgba(0, 0, 0, 0.4);
    }

    /* Slide-out Store Details Inspector Panel */
    .store-inspector {
      position: absolute;
      top: 16px;
      right: 16px;
      width: 410px;
      max-height: calc(100vh - 32px);
      z-index: 1001;
      background: rgba(11, 18, 33, 0.96);
      backdrop-filter: blur(18px);
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 18px;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.7);
      padding: 18px;
      overflow-y: auto;
      transform: translateX(450px);
      transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .store-inspector.open {
      transform: translateX(0);
    }

    /* Custom Leaflet Controls */
    .leaflet-control-zoom { border: none !important; box-shadow: 0 8px 24px rgba(0,0,0,0.5) !important; border-radius: 10px !important; overflow: hidden; margin-bottom: 8px !important; }
    .leaflet-control-zoom a { background: #0f172a !important; color: #f8fafc !important; border-color: #334155 !important; }
    .leaflet-control-attribution { background: rgba(15, 23, 42, 0.8) !important; color: #64748b !important; }
    .leaflet-control-layers {
      background: rgba(15, 23, 42, 0.94) !important;
      backdrop-filter: blur(12px) !important;
      border: 1px solid rgba(255, 255, 255, 0.12) !important;
      border-radius: 10px !important;
      color: #f8fafc !important;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5) !important;
      padding: 6px 10px !important;
      font-size: 11px !important;
    }
    .leaflet-control-layers-toggle { filter: invert(1); }
    .leaflet-control-layers label { color: #cbd5e1 !important; font-weight: 500; margin: 2px 0; }
  </style>
</head>
<body>

  <!-- Fullscreen Interactive Map -->
  <div id="map"></div>

  <!-- Command Header with Live Filters & Telemetry Indicator -->
  <div class="top-header">
    <div class="flex items-center space-x-2.5">
      <div class="w-8 h-8 rounded-lg bg-yellow-400 flex items-center justify-center font-black text-slate-950 text-base shadow">
        A
      </div>
      <div>
        <div class="text-xs font-bold text-white flex items-center gap-1.5">
          Avrora War Map
          <span class="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1 animate-pulse"></span> LIVE DSNS
          </span>
        </div>
        <div class="text-[10px] text-slate-400">National Network &amp; Real-Time Sirens</div>
      </div>
    </div>

    <div class="h-6 w-px bg-slate-700/80 mx-0.5"></div>

    <!-- Quick Filter Tabs -->
    <div class="flex items-center space-x-1.5 text-xs">
      <button onclick="setFilter('ALL')" id="filter-all" class="filter-btn active">
        All (<span id="stat-total">13</span>)
      </button>
      <button onclick="setFilter('SIREN')" id="filter-siren" class="filter-btn text-red-400 hover:text-red-300">
        <i class="fa-solid fa-bell text-[10px] mr-1"></i> Sirens (<span id="stat-alarms-num">--</span>)
      </button>
      <button onclick="setFilter('FRONTLINE')" id="filter-frontline" class="filter-btn text-amber-400 hover:text-amber-300">
        Frontline &lt;25km (<span id="stat-red">--</span>)
      </button>
      <button onclick="setFilter('SAFE')" id="filter-safe" class="filter-btn text-emerald-400 hover:text-emerald-300">
        Safe Rear (<span id="stat-green">--</span>)
      </button>
    </div>

    <!-- Quick Search Input -->
    <div class="relative ml-1 w-44">
      <i class="fa-solid fa-magnifying-glass absolute left-2.5 top-2 text-slate-500 text-xs"></i>
      <input type="text" id="store-search" oninput="handleSearch()" placeholder="Search [ / ]..." class="w-full bg-slate-800/90 border border-slate-700 rounded-lg pl-7 pr-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-yellow-400">
    </div>
  </div>

  <!-- Alerts.in.ua Style Legend -->
  <div class="legend-panel">
    <div class="font-bold text-slate-300 mb-1.5 flex items-center justify-between">
      <span class="flex items-center gap-1.5">
        <i class="fa-solid fa-circle-info text-yellow-400 text-xs"></i> Map Indicators
      </span>
      <span class="text-[9px] text-slate-500 font-mono">15s Live Sync</span>
    </div>
    <div class="space-y-1 text-slate-400">
      <div class="flex items-center gap-2">
        <span class="w-3 h-3 rounded-full bg-red-500 border border-white inline-block"></span>
        <span class="text-red-300 font-semibold">Active Siren (Evacuate to Bunker)</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="w-2.5 h-2.5 rounded-full bg-amber-500 border border-white inline-block"></span>
        <span>Near Frontline (&lt;25km / KAB Risk)</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="w-2.5 h-2.5 rounded-full bg-emerald-500 border border-white inline-block"></span>
        <span>Safe Rear (Normal Trading)</span>
      </div>
      <div class="flex items-center gap-2 pt-1 border-t border-slate-800/70">
        <span class="w-5 h-0.5 border-t-2 border-solid border-sky-400 inline-block"></span>
        <span class="text-[10px] text-sky-400 font-medium">Ukraine State Border</span>
      </div>
    </div>
    <div class="mt-2 pt-1.5 border-t border-slate-800 text-[10px] text-slate-500 flex justify-between">
      <span>Click any store point for details</span>
      <a href="/api/datasheet/csv" download class="text-yellow-400 hover:underline">Download CSV</a>
    </div>
  </div>

  <!-- Store Details Slide-out Inspector Card -->
  <div class="store-inspector" id="inspector">
    <div class="flex items-start justify-between pb-2.5 border-b border-slate-800">
      <div>
        <div class="flex items-center gap-2">
          <span class="text-xs font-bold text-yellow-400 tracking-wider uppercase" id="card-id">AVR-0812</span>
          <span class="text-[10px] px-2 py-0.5 rounded-full font-bold bg-red-500/20 text-red-400 border border-red-500/30" id="card-zone-badge">RED ZONE</span>
        </div>
        <h2 class="text-lg font-bold text-white mt-0.5 leading-tight" id="card-title">Pokrovsk (Center)</h2>
        <div class="text-xs text-slate-400 mt-0.5" id="card-address">24 Soborna St, Donetsk Oblast</div>
        <div class="text-[10px] text-slate-500 font-mono mt-0.5" id="card-coords">48.2831° N, 37.1772° E</div>
      </div>
      <button onclick="closeInspector()" class="text-slate-400 hover:text-white p-1 text-base transition">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>

    <!-- Active Siren Status Banner -->
    <div class="mt-3 p-3 rounded-xl border flex items-center justify-between" id="card-siren-banner">
      <div class="flex items-center space-x-2.5">
        <div class="w-8 h-8 rounded-lg flex items-center justify-center text-sm" id="card-siren-icon">
          <i class="fa-solid fa-bell"></i>
        </div>
        <div>
          <div class="text-xs font-bold uppercase tracking-wide" id="card-siren-title">SIREN ACTIVE</div>
          <div class="text-[11px] opacity-80" id="card-siren-sub">Live alerts feed</div>
        </div>
      </div>
      <div class="text-right">
        <span class="text-[11px] font-bold px-2.5 py-0.5 rounded" id="card-mode-badge">CLOSED</span>
      </div>
    </div>

    <!-- Immediate Life-Saving Directive -->
    <div class="mt-2.5 p-3 rounded-xl bg-slate-900 border border-slate-800">
      <div class="text-[10px] font-bold uppercase text-slate-400 tracking-wider flex items-center justify-between">
        <span>Manager Action Directive</span>
        <span class="text-[10px] text-yellow-400 font-semibold" id="card-action-tag">IMMEDIATE PROTOCOL</span>
      </div>
      <div class="text-xs font-semibold mt-1 leading-snug" id="card-directive">
        STOP CHECKOUT &amp; EVACUATE: Immediate strike threat. Lock cash registers, move shoppers and staff to shelter.
      </div>
    </div>

    <!-- Designated Shelter Details (Crucial Life Safety) -->
    <div class="mt-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs">
      <div class="flex items-center justify-between text-amber-400 font-bold">
        <span class="flex items-center gap-1.5"><i class="fa-solid fa-person-shelter text-sm"></i> Designated Safe Bunker</span>
        <span id="card-shelter-dist" class="px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300 font-bold text-[10px]">70m</span>
      </div>
      <div class="text-slate-200 font-semibold mt-1 text-xs" id="card-shelter">
        Bunker #102 (School Basement), 70m walking distance
      </div>
      <div class="text-[11px] text-slate-400 mt-0.5">
        Mandatory civil defense evacuation point for personnel &amp; shoppers.
      </div>
    </div>

    <!-- Interactive Evacuation Confirmation Button -->
    <div class="mt-2.5 pt-2" id="card-ack-container">
      <button onclick="handleAcknowledgeClick()" id="btn-ack" class="w-full py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition shadow">
        <i class="fa-solid fa-person-shelter"></i> In Shelter - Confirm Evacuation
      </button>
    </div>

    <!-- Operational Intelligence (2x2 Grid) -->
    <div class="mt-3 grid grid-cols-2 gap-2 text-xs">
      <div class="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
        <span class="text-[10px] text-slate-400 block font-medium">Frontline Distance</span>
        <strong class="text-sm font-bold text-yellow-400 mt-0.5 block" id="card-dist">8.8 km</strong>
        <span class="text-[10px] text-slate-500" id="card-zone">Red Zone (&lt; 25 km)</span>
      </div>
      <div class="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
        <span class="text-[10px] text-slate-400 block font-medium">Comms &amp; Connection</span>
        <strong class="text-xs font-bold text-cyan-400 mt-1 block flex items-center gap-1" id="card-comms">
          <i class="fa-solid fa-satellite"></i> Starlink Active
        </strong>
        <span class="text-[10px] text-slate-500">Autonomous Satellite</span>
      </div>
      <div class="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
        <span class="text-[10px] text-slate-400 block font-medium">Power Infrastructure</span>
        <strong class="text-xs font-bold text-amber-400 mt-1 block" id="card-power">Generator Running</strong>
        <span class="text-[10px] text-slate-400 block" id="card-fuel-runtime">75 L · ~12.5 hrs</span>
      </div>
      <div class="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
        <span class="text-[10px] text-slate-400 block font-medium">Logistics &amp; Delivery ETA</span>
        <strong class="text-xs font-bold text-slate-200 mt-1 block" id="card-eta">Today 16:30</strong>
        <span class="text-[10px] text-slate-400 block truncate" id="card-restock">Flashlights, Water</span>
      </div>
    </div>

    <!-- Manager Emergency Contact & 1-Click Dial -->
    <div class="mt-2.5 p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between text-xs">
      <div class="flex items-center space-x-2 text-slate-300">
        <i class="fa-solid fa-user-shield text-slate-500"></i>
        <div>
          <div class="font-medium text-white" id="card-manager">Serhiy Kovalenko</div>
          <div class="text-[10px] text-slate-400">Store Manager</div>
        </div>
      </div>
      <a href="tel:+380501234501" id="card-phone-link" class="px-3 py-1.5 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition shadow">
        <i class="fa-solid fa-phone text-[10px]"></i> <span id="card-phone">+380501234501</span>
      </a>
    </div>
  </div>

  <!-- Floating Quick Store Selector Bar at the bottom -->
  <div class="store-quick-bar" id="quick-store-bar"></div>

  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    let map;
    let storesData = [];
    let markersMap = {};
    let activeSelectedStore = null;
    let hasFittedInitialBounds = false;
    let currentFilter = 'ALL';
    let borderLayer = null;

    // Initialize Map with dark basemap
    function initMap() {
      const esriDarkBase = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; Esri &copy; OpenStreetMap | alerts.in.ua | DeepStateMap',
        maxNativeZoom: 16,
        maxZoom: 19
      });

      const esriDarkLabels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
        attribution: '',
        maxNativeZoom: 16,
        maxZoom: 19
      });

      const esriDarkGroup = L.layerGroup([esriDarkBase, esriDarkLabels]);

      const osmDark = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        className: 'osm-dark-tiles',
        attribution: '&copy; OpenStreetMap contributors | alerts.in.ua',
        maxZoom: 19
      });

      map = L.map('map', {
        zoomControl: false,
        minZoom: 5,
        maxZoom: 19,
        layers: [esriDarkGroup]
      }).setView([48.6, 31.5], 6.5);

      L.control.layers({
        "Tactical Dark (Esri)": esriDarkGroup,
        "Street Dark (OSM)": osmDark
      }, null, { position: 'bottomright' }).addTo(map);

      L.control.zoom({ position: 'bottomright' }).addTo(map);

      loadUkraineBorder();
      fetchStoreTelemetry();
      setInterval(fetchStoreTelemetry, 15000);

      // Keyboard shortcuts
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeInspector();
        if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
          e.preventDefault();
          document.getElementById('store-search').focus();
        }
      });
    }

    async function loadUkraineBorder() {
      try {
        const res = await fetch('/api/border');
        const data = await res.json();
        if (data) {
          borderLayer = L.geoJSON(data, {
            style: {
              color: '#38bdf8',
              weight: 2,
              opacity: 0.85,
              fillColor: '#0284c7',
              fillOpacity: 0.04
            }
          }).addTo(map);

          if (!hasFittedInitialBounds) {
            map.fitBounds(borderLayer.getBounds(), { padding: [35, 35] });
            hasFittedInitialBounds = true;
          }
        }
      } catch (e) {
        console.warn("Ukraine border load failed:", e);
      }
    }

    async function fetchStoreTelemetry() {
      try {
        const [sheetRes, summaryRes] = await Promise.all([
          fetch('/api/datasheet'),
          fetch('/api/summary')
        ]);
        storesData = await sheetRes.json();
        const summary = await summaryRes.json();

        updateHeaderStats(summary);
        renderStorePoints();

        if (activeSelectedStore) {
          const updated = storesData.find(s => s.store_id === activeSelectedStore.store_id);
          if (updated) openInspector(updated);
        }
      } catch (err) {
        console.error("Telemetry fetch error:", err);
      }
    }

    function updateHeaderStats(summary) {
      document.getElementById('stat-total').textContent = summary.total_stores || storesData.length;
      document.getElementById('stat-alarms-num').textContent = summary.stores_under_alarm || 0;
      document.getElementById('stat-red').textContent = summary.stores_in_red_zone || 0;
      document.getElementById('stat-green').textContent = summary.stores_in_green_zone || 0;
    }

    function setFilter(filterType) {
      currentFilter = filterType;
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      if (filterType === 'ALL') document.getElementById('filter-all').classList.add('active');
      else if (filterType === 'SIREN') document.getElementById('filter-siren').classList.add('active');
      else if (filterType === 'FRONTLINE') document.getElementById('filter-frontline').classList.add('active');
      else if (filterType === 'SAFE') document.getElementById('filter-safe').classList.add('active');
      renderStorePoints();
    }

    function getFilteredStores() {
      if (currentFilter === 'SIREN') {
        return storesData.filter(s => s.alert_status && s.alert_status !== 'CLEAR');
      } else if (currentFilter === 'FRONTLINE') {
        return storesData.filter(s => s.threat_zone === 'RED');
      } else if (currentFilter === 'SAFE') {
        return storesData.filter(s => s.threat_zone === 'GREEN');
      }
      return storesData;
    }

    function renderStorePoints() {
      Object.values(markersMap).forEach(m => map.removeLayer(m));
      markersMap = {};

      const filtered = getFilteredStores();
      const bounds = [];

      filtered.forEach(store => {
        if (!store.lat || !store.lon) return;

        bounds.push([store.lat, store.lon]);

        const isSiren = (store.alert_status && store.alert_status !== 'CLEAR');
        let pinClass = 'pin-green';
        let pinIcon = '<i class="fa-solid fa-store text-[10px]"></i>';
        let size = 26;

        if (isSiren) {
          pinClass = 'pin-siren';
          pinIcon = '<i class="fa-solid fa-bell text-[11px] animate-bounce"></i>';
          size = 32;
        } else if (store.threat_zone === 'RED') {
          pinClass = 'pin-frontline-red';
          pinIcon = '<i class="fa-solid fa-triangle-exclamation text-[10px]"></i>';
          size = 28;
        } else if (store.threat_zone === 'ORANGE') {
          pinClass = 'pin-amber';
          pinIcon = '<i class="fa-solid fa-shield-halved text-[10px]"></i>';
          size = 26;
        }

        const isSelected = activeSelectedStore && (activeSelectedStore.store_id === store.store_id);

        const icon = L.divIcon({
          className: 'custom-pin-wrapper',
          html: `
            <div class="pin-container ${isSelected ? 'pin-selected' : ''}">
              <div class="store-marker-pin ${pinClass}" style="width:${size}px; height:${size}px;">
                ${pinIcon}
              </div>
              <div class="pin-label">${store.city}</div>
            </div>
          `,
          iconSize: [size, size + 16],
          iconAnchor: [size / 2, size / 2]
        });

        const marker = L.marker([store.lat, store.lon], { icon: icon });
        
        marker.bindTooltip(`
          <div style="font-size:11px; font-weight:700; color:#f8fafc; line-height:1.2;">
            ${store.store_id} · ${store.city}
            ${isSiren ? '<span style="color:#ef4444; margin-left:4px;">🚨 SIREN</span>' : ''}
          </div>
          <div style="font-size:10px; color:#94a3b8; margin-top:2px;">
            ${store.dist_frontline_km} km front · ${store.threat_zone} Zone
          </div>
        `, { direction: 'top', offset: [0, -12], opacity: 0.95 });

        marker.on('click', () => {
          openInspector(store);
          map.flyTo([store.lat, store.lon], Math.max(map.getZoom(), 11), { duration: 0.7 });
        });

        marker.addTo(map);
        markersMap[store.store_id] = marker;
      });

      renderQuickBar(filtered);

      if (!hasFittedInitialBounds && bounds.length > 0) {
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 8 });
        hasFittedInitialBounds = true;
      }
    }

    function renderQuickBar(storesToRender) {
      const container = document.getElementById('quick-store-bar');
      if (!container) return;
      container.innerHTML = '';

      const list = storesToRender || getFilteredStores();

      list.forEach(store => {
        const isSiren = (store.alert_status && store.alert_status !== 'CLEAR');
        const isSelected = activeSelectedStore && (activeSelectedStore.store_id === store.store_id);
        const pill = document.createElement('div');
        pill.className = `store-pill ${isSelected ? 'active' : ''}`;
        
        let statusDot = '<span class="w-2 h-2 rounded-full bg-emerald-400"></span>';
        if (isSiren) {
          statusDot = '<span class="w-2 h-2 rounded-full bg-red-500 animate-ping"></span>';
        } else if (store.threat_zone === 'RED') {
          statusDot = '<span class="w-2 h-2 rounded-full bg-orange-500"></span>';
        }

        pill.innerHTML = `${statusDot} <span>${store.city}</span> <span class="text-[9px] text-slate-400 font-mono">${store.store_id}</span>`;
        pill.onclick = () => {
          openInspector(store);
          map.flyTo([store.lat, store.lon], Math.max(map.getZoom(), 11), { duration: 0.7 });
        };
        container.appendChild(pill);
      });
    }

    function openInspector(store) {
      activeSelectedStore = store;
      const isSiren = (store.alert_status && store.alert_status !== 'CLEAR');

      document.getElementById('card-id').textContent = store.store_id;
      document.getElementById('card-title').textContent = `${store.city} (${store.name ? store.name.split(' - ')[1] || 'Store' : 'Store'})`;
      document.getElementById('card-address').textContent = `${store.address}, ${store.oblast}`;
      document.getElementById('card-coords').textContent = `${store.lat}° N, ${store.lon}° E`;

      // Threat Zone Badge
      const zoneBadge = document.getElementById('card-zone-badge');
      zoneBadge.textContent = `${store.threat_zone} ZONE`;
      if (store.threat_zone === 'RED') {
        zoneBadge.className = "text-[10px] px-2 py-0.5 rounded-full font-bold bg-red-500/20 text-red-400 border border-red-500/30";
      } else if (store.threat_zone === 'ORANGE') {
        zoneBadge.className = "text-[10px] px-2 py-0.5 rounded-full font-bold bg-orange-500/20 text-orange-400 border border-orange-500/30";
      } else {
        zoneBadge.className = "text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30";
      }

      // Siren Banner
      const banner = document.getElementById('card-siren-banner');
      const sirenTitle = document.getElementById('card-siren-title');
      const sirenSub = document.getElementById('card-siren-sub');
      const sirenIcon = document.getElementById('card-siren-icon');
      const modeBadge = document.getElementById('card-mode-badge');

      if (isSiren) {
        banner.className = "mt-3 p-3 rounded-xl border bg-red-950/40 border-red-800/60 text-red-200 flex items-center justify-between";
        sirenTitle.textContent = "AIR RAID SIREN ACTIVE";
        sirenSub.textContent = "Confirmed by DSNS Live Alert Feed";
        sirenIcon.className = "w-8 h-8 rounded-lg bg-red-600 text-white flex items-center justify-center text-sm shadow animate-pulse";
        modeBadge.className = "text-[11px] font-bold px-2.5 py-0.5 rounded bg-red-600 text-white";
        modeBadge.textContent = "EVACUATE";
      } else {
        banner.className = "mt-3 p-3 rounded-xl border bg-emerald-950/30 border-emerald-800/40 text-emerald-200 flex items-center justify-between";
        sirenTitle.textContent = "ALL CLEAR · NO SIREN";
        sirenSub.textContent = "No air raid alert active in this region";
        sirenIcon.className = "w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center text-sm";
        modeBadge.className = "text-[11px] font-bold px-2.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400";
        modeBadge.textContent = "OPEN";
      }

      // Directive
      const directive = document.getElementById('card-directive');
      directive.textContent = store.action_en || "NORMAL OPERATIONS: Standard retail hours.";
      if (store.action_color === 'red') directive.className = "text-xs font-bold text-red-400 mt-1 leading-snug";
      else if (store.action_color === 'amber') directive.className = "text-xs font-semibold text-amber-400 mt-1 leading-snug";
      else directive.className = "text-xs text-slate-300 mt-1 leading-snug";

      // Meta
      document.getElementById('card-dist').textContent = `${store.dist_frontline_km} km`;
      document.getElementById('card-zone').textContent = store.threat_zone_label || `${store.threat_zone} Zone`;
      
      const comms = document.getElementById('card-comms');
      if (store.comms_status === 'starlink') {
        comms.innerHTML = '<i class="fa-solid fa-satellite text-cyan-400"></i> Starlink 42ms';
      } else {
        comms.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400 inline-block mr-1"></span> Fiber Online';
      }

      // Power Infrastructure
      const powerEl = document.getElementById('card-power');
      if (store.power_status === 'generator') {
        powerEl.textContent = "Generator Running";
        powerEl.className = "text-xs font-bold text-amber-400 mt-1 block";
      } else if (store.power_status === 'blackout') {
        powerEl.textContent = "Grid Blackout";
        powerEl.className = "text-xs font-bold text-red-400 mt-1 block";
      } else {
        powerEl.textContent = "Grid Power Normal";
        powerEl.className = "text-xs font-bold text-emerald-400 mt-1 block";
      }

      const fuelText = store.generator_fuel_l ? `${store.generator_fuel_l}L` : 'Grid';
      const runtimeText = store.generator_runtime_hours ? `~${store.generator_runtime_hours}h runtime` : 'Stable';
      document.getElementById('card-fuel-runtime').textContent = `${fuelText} · ${runtimeText}`;

      // Logistics
      document.getElementById('card-eta').textContent = store.delivery_eta || 'Scheduled';
      document.getElementById('card-restock').textContent = store.priority_restock || 'Standard Retail Assortment';

      // Shelter & Contact
      document.getElementById('card-shelter').textContent = store.shelter_nearby || "Nearest certified civil defense bunker";
      
      // Extract walking distance if present (e.g. 70m)
      const distMatch = (store.shelter_nearby || "").match(/(\d+\s*m)/i);
      document.getElementById('card-shelter-dist').textContent = distMatch ? distMatch[1] : 'Nearby';

      document.getElementById('card-manager').textContent = store.manager_name || "Store Manager";
      const phone = store.manager_phone || "+380501234500";
      document.getElementById('card-phone').textContent = phone;
      document.getElementById('card-phone-link').href = `tel:${phone}`;

      // Acknowledgment Button
      const btnAck = document.getElementById('btn-ack');
      if (isSiren) {
        if (store.ack_status === 'CONFIRMED_IN_SHELTER') {
          btnAck.className = "w-full py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 cursor-pointer";
          btnAck.innerHTML = `<i class="fa-solid fa-check-double text-emerald-400"></i> ${store.ack_label || 'Evacuation Confirmed by Manager'}`;
        } else {
          btnAck.className = "w-full py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/40 animate-pulse cursor-pointer";
          btnAck.innerHTML = `<i class="fa-solid fa-person-shelter"></i> In Shelter - Confirm Evacuation`;
        }
      } else {
        btnAck.className = "w-full py-2 px-3 rounded-xl font-medium text-xs flex items-center justify-center gap-2 bg-slate-800 text-slate-400 cursor-default";
        btnAck.innerHTML = `<i class="fa-solid fa-circle-check text-emerald-400"></i> Normal Trading (No Siren Active)`;
      }

      document.getElementById('inspector').classList.add('open');
      renderStorePoints();
    }

    function closeInspector() {
      activeSelectedStore = null;
      document.getElementById('inspector').classList.remove('open');
      renderStorePoints();
    }

    async function handleAcknowledgeClick() {
      if (!activeSelectedStore) return;
      if (activeSelectedStore.alert_status === 'CLEAR') return;

      try {
        if (activeSelectedStore.ack_status === 'CONFIRMED_IN_SHELTER') {
          await fetch(`/api/stores/${activeSelectedStore.store_id}/reset-ack`, { method: 'POST' });
        } else {
          await fetch(`/api/stores/${activeSelectedStore.store_id}/acknowledge`, { method: 'POST' });
        }
        await fetchStoreTelemetry();
      } catch (err) {
        console.error("Ack error:", err);
      }
    }

    function handleSearch() {
      const q = document.getElementById('store-search').value.toLowerCase().trim();
      if (!q) return;

      const found = storesData.find(s => 
        (s.city && s.city.toLowerCase().includes(q)) ||
        (s.store_id && s.store_id.toLowerCase().includes(q)) ||
        (s.name && s.name.toLowerCase().includes(q))
      );

      if (found) {
        openInspector(found);
        map.flyTo([found.lat, found.lon], 12, { duration: 0.6 });
      }
    }

    window.addEventListener('DOMContentLoaded', initMap);
  </script>
</body>
</html>
"""


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)
