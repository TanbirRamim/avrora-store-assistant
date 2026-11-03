import os
import json
from typing import Optional
from fastapi import FastAPI, Query, HTTPException, Path as FastPath
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from config import CSV_OUTPUT_PATH, JSON_OUTPUT_PATH, METRICS_OUTPUT_PATH
from engine.orchestrator import WarMapOrchestrator

app = FastAPI(
    title="Avrora War Map Situational Intelligence",
    description="Dual-mode real-time threat & logistics monitor for Avrora stores in Ukraine",
    version="2.5.0"
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
    """Returns chain-wide threat and logistics metrics."""
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
    """Returns dual-mode real-time data sheet rows."""
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
    """Manager acknowledgment: confirms store staff and customers evacuated to shelter."""
    ack = orchestrator.acknowledge_shelter(store_id)
    # Refresh cycle to update exports
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
    """Download current CSV datasheet."""
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
        "message": "Data sheet synchronized with latest war maps",
        "summary": summary
    }


@app.get("/", response_class=HTMLResponse)
def get_dashboard_html():
    """
    Dual-mode Web Dashboard:
    - View 1: Life Safety (Sirens, Directives, Shelters, Acknowledgment Loop)
    - View 2: Logistics & Supply (Surge Demand, Delivery ETA, Generator Autonomy)
    """
    return """<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Avrora War Map Monitor: Safety & Logistics</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            avrora: { yellow: '#FFD700', red: '#E60000', dark: '#0F172A', card: '#1E293B' }
          }
        }
      }
    }
  </script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    @keyframes pulse-red {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.45; transform: scale(0.98); }
    }
    .alarm-pulse { animation: pulse-red 1.5s infinite ease-in-out; }
  </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen font-sans antialiased">
  
  <!-- Header with View Switcher -->
  <header class="border-b border-slate-800 bg-slate-900/95 backdrop-blur sticky top-0 z-50">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap justify-between items-center gap-4">
      
      <!-- Brand & Status -->
      <div class="flex items-center space-x-3.5">
        <div class="w-9 h-9 rounded-lg bg-yellow-400 flex items-center justify-center font-black text-slate-950 text-lg shadow">
          A
        </div>
        <div>
          <h1 class="text-base font-bold text-white flex items-center gap-2">
            Avrora Stores: Real-Time War Threat & Logistics Monitor
            <span id="source-status" class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">Checking sources…</span>
          </h1>
          <p class="text-xs text-slate-400">DeepStateMap Frontlines + Alerts.in.ua Sirens + Store Comms & Power Telemetry</p>
        </div>
      </div>

      <!-- Controls & View Toggle -->
      <div class="flex items-center space-x-3 text-xs">
        
        <!-- View Switcher -->
        <div class="inline-flex rounded-lg bg-slate-800 p-1 border border-slate-700">
          <button onclick="setViewMode('safety')" id="btn-mode-safety" class="px-3 py-1.5 rounded-md font-bold transition flex items-center gap-1.5 bg-yellow-500 text-slate-950 shadow">
            <i class="fa-solid fa-shield-halved"></i> Life Safety View
          </button>
          <button onclick="setViewMode('logistics')" id="btn-mode-logistics" class="px-3 py-1.5 rounded-md font-medium text-slate-300 hover:text-white transition flex items-center gap-1.5">
            <i class="fa-solid fa-truck-ramp-box"></i> Logistics & Supply View
          </button>
        </div>

        <button onclick="refreshData()" class="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition font-medium">
          <i class="fa-solid fa-arrows-rotate" id="refresh-icon"></i> Refresh
        </button>
        
        <a href="/api/datasheet/csv" download class="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold flex items-center gap-1.5 transition">
          <i class="fa-solid fa-file-csv text-yellow-400"></i> Export CSV
        </a>
      </div>
    </div>
  </header>

  <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 space-y-5">
    
    <!-- Dynamic KPI Cards depending on View -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3.5" id="kpi-cards">
      <!-- Populated via Javascript depending on active view -->
    </div>

    <!-- Filters & Search Toolbar -->
    <div class="p-3 rounded-xl bg-slate-900 border border-slate-800 flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-xs font-semibold text-slate-400 mr-1"><i class="fa-solid fa-filter"></i> Zone:</span>
        <button onclick="setZoneFilter('ALL')" id="btn-zone-ALL" class="filter-btn px-2.5 py-1 rounded-lg text-xs font-bold bg-yellow-500 text-slate-950">All</button>
        <button onclick="setZoneFilter('RED')" id="btn-zone-RED" class="filter-btn px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 text-rose-400 hover:bg-slate-700">Red (&lt; 25km)</button>
        <button onclick="setZoneFilter('ORANGE')" id="btn-zone-ORANGE" class="filter-btn px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 text-amber-400 hover:bg-slate-700">Orange (25-65km)</button>
        <button onclick="setZoneFilter('YELLOW')" id="btn-zone-YELLOW" class="filter-btn px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 text-yellow-400 hover:bg-slate-700">Yellow</button>
        <button onclick="setZoneFilter('GREEN')" id="btn-zone-GREEN" class="filter-btn px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 text-emerald-400 hover:bg-slate-700">Green</button>
        
        <label class="ml-2 flex items-center space-x-2 text-xs text-slate-300 cursor-pointer select-none">
          <input type="checkbox" id="alarm-toggle" onchange="toggleAlarmOnly()" class="rounded bg-slate-800 border-slate-700 text-red-500">
          <span>Active Sirens Only 🚨</span>
        </label>
      </div>

      <div class="relative w-full sm:w-64">
        <i class="fa-solid fa-magnifying-glass absolute left-3 top-2.5 text-slate-500 text-xs"></i>
        <input type="text" id="search-input" oninput="handleSearch()" placeholder="Search city or store ID..." class="w-full bg-slate-800 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-yellow-500">
      </div>
    </div>

    <!-- Data Table -->
    <div class="overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-xl">
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse text-xs">
          <thead id="table-head">
            <!-- Headers injected based on safety vs logistics view -->
          </thead>
          <tbody id="table-body" class="divide-y divide-slate-800/60 font-normal">
            <!-- Rows injected -->
          </tbody>
        </table>
      </div>
      
      <!-- Minimalist Footer -->
      <div class="px-4 py-2.5 bg-slate-950 border-t border-slate-800 text-[11px] text-slate-400 flex flex-wrap justify-between items-center gap-2">
        <div id="status-time">Last telemetry sync: --</div>
        <div class="flex items-center gap-4">
          <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-emerald-400"></span> Online</span>
          <span class="flex items-center gap-1.5"><i class="fa-solid fa-satellite text-cyan-400"></i> Starlink</span>
          <span class="flex items-center gap-1.5"><i class="fa-solid fa-gas-pump text-amber-400"></i> Generator</span>
          <span class="text-slate-600">|</span>
          <span>Auto-refreshes every 15s</span>
        </div>
      </div>
    </div>

  </main>

  <script>
    let currentData = [];
    let currentSummary = {};
    let activeViewMode = 'safety'; // 'safety' or 'logistics'
    let activeZoneFilter = 'ALL';
    let alarmOnlyFilter = false;
    let searchQuery = '';

    function setViewMode(mode) {
      activeViewMode = mode;
      const btnSafety = document.getElementById('btn-mode-safety');
      const btnLogistics = document.getElementById('btn-mode-logistics');

      if (mode === 'safety') {
        btnSafety.className = "px-3 py-1.5 rounded-md font-bold transition flex items-center gap-1.5 bg-yellow-500 text-slate-950 shadow";
        btnLogistics.className = "px-3 py-1.5 rounded-md font-medium text-slate-300 hover:text-white transition flex items-center gap-1.5";
      } else {
        btnLogistics.className = "px-3 py-1.5 rounded-md font-bold transition flex items-center gap-1.5 bg-yellow-500 text-slate-950 shadow";
        btnSafety.className = "px-3 py-1.5 rounded-md font-medium text-slate-300 hover:text-white transition flex items-center gap-1.5";
      }

      renderKpis();
      renderTable();
    }

    async function loadData() {
      try {
        const [sheetRes, summaryRes] = await Promise.all([
          fetch('/api/datasheet'),
          fetch('/api/summary')
        ]);
        currentData = await sheetRes.json();
        currentSummary = await summaryRes.json();

        renderSourceStatus();
        renderKpis();
        renderTable();
      } catch (err) {
        console.error("Failed to load telemetry:", err);
      }
    }

    function renderSourceStatus() {
      const element = document.getElementById('source-status');
      if (!element) return;
      const alertsSimulated = Boolean(currentSummary.alerts_is_simulated);
      const frontlineFallback = Boolean(currentSummary.frontline_data_is_fallback);
      const oblastOnly = currentSummary.alerts_coverage === 'oblast_only';
      const alertLabel = alertsSimulated ? 'Alerts simulated' : (oblastOnly ? 'Alerts live · oblast only' : 'Alerts live · oblast + hromada');
      const frontLabel = frontlineFallback ? 'frontline fallback' : 'frontline current';
      element.textContent = alertLabel + ' · ' + frontLabel;
      element.className = alertsSimulated || frontlineFallback
        ? 'inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-red-500/10 text-red-300 border border-red-500/30'
        : oblastOnly
          ? 'inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30'
          : 'inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
    }

    function renderKpis() {
      const container = document.getElementById('kpi-cards');
      if (activeViewMode === 'safety') {
        const pendingBadge = currentSummary.stores_pending_ack > 0 
          ? `<span class="alarm-pulse px-2 py-0.5 rounded text-[10px] font-bold bg-red-600 text-white ml-2">ACTION NEEDED</span>` 
          : `<span class="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/20 text-emerald-400 ml-2">All Confirmed</span>`;

        container.innerHTML = `
          <div class="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
            <span class="text-xs text-slate-400 font-medium">Stores Tracked</span>
            <div class="text-2xl font-bold text-white mt-1">${currentSummary.total_stores || '--'}</div>
          </div>
          <div class="p-3.5 rounded-xl bg-red-950/40 border border-red-800/40">
            <div class="text-xs text-red-300 font-medium flex items-center justify-between">
              <span><i class="fa-solid fa-bell text-red-400 alarm-pulse mr-1"></i> Active Siren (Shelter)</span>
            </div>
            <div class="text-2xl font-bold text-red-400 mt-1">${currentSummary.stores_under_alarm || '0'}</div>
          </div>
          <div class="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
            <div class="text-xs text-slate-300 font-medium flex items-center justify-between">
              <span>Evacuation Acknowledgment</span>
              ${pendingBadge}
            </div>
            <div class="text-2xl font-bold text-white mt-1">
              ${currentSummary.stores_evacuated_confirmed || 0} <span class="text-xs text-slate-500 font-normal">/ ${currentSummary.stores_under_alarm || 0} confirmed</span>
            </div>
          </div>
          <div class="p-3.5 rounded-xl bg-rose-950/30 border border-rose-800/30">
            <span class="text-xs text-rose-300 font-medium">Red Zone (&lt; 25 km)</span>
            <div class="text-2xl font-bold text-rose-400 mt-1">${currentSummary.stores_in_red_zone || '0'}</div>
          </div>
        `;
      } else {
        container.innerHTML = `
          <div class="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
            <span class="text-xs text-slate-400 font-medium">Total Stores</span>
            <div class="text-2xl font-bold text-white mt-1">${currentSummary.total_stores || '--'}</div>
          </div>
          <div class="p-3.5 rounded-xl bg-amber-950/30 border border-amber-800/30">
            <span class="text-xs text-amber-300 font-medium flex items-center gap-1.5">
              <i class="fa-solid fa-gas-pump text-amber-400"></i> On Generator Power
            </span>
            <div class="text-2xl font-bold text-amber-400 mt-1">${currentSummary.stores_on_generator || '0'}</div>
          </div>
          <div class="p-3.5 rounded-xl bg-red-950/40 border border-red-800/40">
            <span class="text-xs text-red-300 font-medium flex items-center gap-1.5">
              <i class="fa-solid fa-triangle-exclamation text-red-400"></i> Blackout / Low Autonomy
            </span>
            <div class="text-2xl font-bold text-red-400 mt-1">${currentSummary.stores_blackout || '0'}</div>
          </div>
          <div class="p-3.5 rounded-xl bg-yellow-950/30 border border-yellow-800/30">
            <span class="text-xs text-yellow-300 font-medium">High Surge Demand</span>
            <div class="text-2xl font-bold text-yellow-400 mt-1">${currentSummary.stores_in_red_zone + currentSummary.stores_in_orange_zone || '0'}</div>
          </div>
        `;
      }

      document.getElementById('status-time').textContent = 'Last telemetry sync: ' + currentSummary.generated_at;
    }

    function renderTable() {
      const thead = document.getElementById('table-head');
      const tbody = document.getElementById('table-body');
      tbody.innerHTML = '';

      // Set Headings based on mode
      if (activeViewMode === 'safety') {
        thead.innerHTML = `
          <tr class="border-b border-slate-800 bg-slate-950 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
            <th class="py-3 px-3.5">Store / Comms & Power</th>
            <th class="py-3 px-3">Frontline Dist</th>
            <th class="py-3 px-3">Danger Zone</th>
            <th class="py-3 px-3">Air Siren Status</th>
            <th class="py-3 px-3">Manager Action Directive</th>
            <th class="py-3 px-3">Nearest Shelter</th>
            <th class="py-3 px-3 text-center">Shelter Acknowledgment</th>
          </tr>
        `;
      } else {
        thead.innerHTML = `
          <tr class="border-b border-slate-800 bg-slate-950 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
            <th class="py-3 px-3.5">Store / Comms</th>
            <th class="py-3 px-3">Frontline Dist</th>
            <th class="py-3 px-3">Danger Zone</th>
            <th class="py-3 px-3">Predicted Surge Demand</th>
            <th class="py-3 px-3">Delivery ETA & Route Safety</th>
            <th class="py-3 px-3">Power & Generator Runtime</th>
            <th class="py-3 px-3">Priority Restock Categories</th>
          </tr>
        `;
      }

      const filtered = currentData.filter(r => {
        if (activeZoneFilter !== 'ALL' && r.threat_zone !== activeZoneFilter) return false;
        if (alarmOnlyFilter && r.alert_status === 'CLEAR') return false;
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          const match = (r.city && r.city.toLowerCase().includes(q)) ||
                        (r.name && r.name.toLowerCase().includes(q)) ||
                        (r.address && r.address.toLowerCase().includes(q)) ||
                        (r.store_id && r.store_id.toLowerCase().includes(q));
          if (!match) return false;
        }
        return true;
      });

      if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-slate-500">No stores match the active filter criteria.</td></tr>`;
        return;
      }

      filtered.forEach(r => {
        const tr = document.createElement('tr');
        
        // Pulse red row if siren is active and unacknowledged
        const isUrgentUnacknowledged = (r.alert_status !== 'CLEAR' && r.ack_status === 'PENDING_CONFIRMATION');
        tr.className = isUrgentUnacknowledged 
          ? 'bg-red-950/25 border-l-4 border-red-500 hover:bg-red-950/40 transition' 
          : 'hover:bg-slate-800/40 transition';

        // 1. Comms & Power Indicators
        let commsIcon = '';
        if (r.comms_status === 'starlink') {
          commsIcon = `<span class="inline-flex items-center text-[10px] text-cyan-400 font-medium" title="Connected via Starlink Terminal"><i class="fa-solid fa-satellite mr-1"></i> Starlink</span>`;
        } else if (r.comms_status === 'cellular') {
          commsIcon = `<span class="inline-flex items-center text-[10px] text-blue-400 font-medium" title="Cellular Backup"><i class="fa-solid fa-tower-broadcast mr-1"></i> 4G/Cell</span>`;
        } else if (r.comms_status === 'offline') {
          commsIcon = `<span class="inline-flex items-center text-[10px] text-red-400 font-medium" title="Connection Lost"><i class="fa-solid fa-ban mr-1"></i> Offline</span>`;
        } else {
          commsIcon = `<span class="inline-flex items-center text-[10px] text-emerald-400 font-medium" title="Broadband Fiber"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1"></span> Online</span>`;
        }

        let powerIcon = '';
        if (r.power_status === 'generator') {
          powerIcon = `<span class="inline-flex items-center text-[10px] text-amber-400 font-medium ml-2" title="Running on Generator: ${r.generator_fuel_l}L fuel left"><i class="fa-solid fa-gas-pump mr-1"></i> Gen (${r.generator_fuel_l}L)</span>`;
        } else if (r.power_status === 'blackout') {
          powerIcon = `<span class="inline-flex items-center text-[10px] text-red-400 font-bold ml-2" title="Power Outage / Generator Depleted"><i class="fa-solid fa-triangle-exclamation mr-1"></i> Blackout</span>`;
        } else {
          powerIcon = `<span class="inline-flex items-center text-[10px] text-slate-400 font-medium ml-2" title="Grid Electricity Normal"><i class="fa-solid fa-bolt text-yellow-400 mr-1"></i> Grid</span>`;
        }

        // 2. Zone Badge
        let zoneBadge = '';
        if (r.threat_zone === 'RED') {
          zoneBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded font-bold bg-rose-500/15 text-rose-400 border border-rose-500/20">RED (&lt;25km)</span>`;
        } else if (r.threat_zone === 'ORANGE') {
          zoneBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/20">ORANGE (25-65km)</span>`;
        } else if (r.threat_zone === 'YELLOW') {
          zoneBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded font-medium bg-yellow-500/15 text-yellow-400 border border-yellow-500/20">YELLOW (65-120km)</span>`;
        } else {
          zoneBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">GREEN REAR</span>`;
        }

        if (activeViewMode === 'safety') {
          // --- LIFE SAFETY VIEW ---
          let sirenBadge = '';
          if (r.alert_status.includes('HROMADA')) {
            sirenBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded font-bold bg-red-600 text-white alarm-pulse"><i class="fa-solid fa-bell mr-1"></i> SIREN ACTIVE</span>`;
          } else if (r.alert_status.includes('OBLAST')) {
            sirenBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded font-semibold bg-amber-600 text-black"><i class="fa-solid fa-triangle-exclamation mr-1"></i> REGIONAL SIREN</span>`;
          } else {
            sirenBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded text-emerald-400 font-medium"><i class="fa-solid fa-circle-check mr-1"></i> ALL CLEAR</span>`;
          }

          // Strict Color Hierarchy for Action Directive
          let actionStyled = '';
          if (r.action_color === 'red') {
            actionStyled = `<span class="text-red-400 font-bold">${r.action_en}</span>`;
          } else if (r.action_color === 'amber') {
            actionStyled = `<span class="text-amber-400 font-medium">${r.action_en}</span>`;
          } else if (r.action_color === 'yellow') {
            actionStyled = `<span class="text-yellow-300">${r.action_en}</span>`;
          } else {
            actionStyled = `<span class="text-slate-300">${r.action_en}</span>`;
          }

          // Acknowledgment Button / Status
          let ackContent = '';
          if (r.alert_status !== 'CLEAR') {
            if (r.ack_status === 'CONFIRMED_IN_SHELTER') {
              ackContent = `
                <div class="flex items-center justify-center gap-1.5">
                  <span class="inline-flex items-center px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30 text-[11px]">
                    <i class="fa-solid fa-check-double mr-1"></i> ${r.ack_label}
                  </span>
                  <button onclick="resetAck('${r.store_id}')" title="Reset confirmation" class="text-slate-500 hover:text-slate-300 text-xs px-1"><i class="fa-solid fa-rotate-left"></i></button>
                </div>
              `;
            } else {
              ackContent = `
                <button onclick="confirmShelter('${r.store_id}')" class="alarm-pulse px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-black text-[11px] shadow-lg shadow-red-600/30 flex items-center justify-center gap-1.5 mx-auto">
                  <i class="fa-solid fa-person-shelter"></i> In Shelter - Acknowledge
                </button>
              `;
            }
          } else {
            ackContent = `<span class="text-slate-500 text-center block text-[11px]"><i class="fa-solid fa-circle-check text-emerald-500 mr-1"></i> Normal Trading</span>`;
          }

          tr.innerHTML = `
            <td class="py-3 px-3.5">
              <div class="font-bold text-white text-xs">${r.store_id} - ${r.city}</div>
              <div class="text-[11px] text-slate-400">${r.address}</div>
              <div class="mt-1 flex items-center">${commsIcon} ${powerIcon}</div>
            </td>
            <td class="py-3 px-3 font-semibold text-slate-200">
              <span class="text-sm font-bold text-yellow-400">${r.dist_frontline_km}</span> km
            </td>
            <td class="py-3 px-3">${zoneBadge}</td>
            <td class="py-3 px-3">${sirenBadge}</td>
            <td class="py-3 px-3 text-[11px] leading-snug max-w-sm">
              ${actionStyled}
            </td>
            <td class="py-3 px-3 text-[11px] text-slate-300">
              <i class="fa-solid fa-person-shelter text-yellow-400 mr-1.5"></i>${r.shelter_nearby}
              <div class="text-[10px] text-slate-500 mt-0.5"><i class="fa-solid fa-user-shield mr-1"></i>${r.manager_name}</div>
            </td>
            <td class="py-3 px-3 text-center">
              ${ackContent}
            </td>
          `;

        } else {
          // --- LOGISTICS & SUPPLY VIEW ---
          let surgeBadge = '';
          if (r.surge_level === 'CRITICAL') {
            surgeBadge = `<span class="px-2 py-0.5 rounded font-black bg-rose-500/20 text-rose-400 border border-rose-500/30">🔥 CRITICAL SURGE</span>`;
          } else if (r.surge_level === 'HIGH') {
            surgeBadge = `<span class="px-2 py-0.5 rounded font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">⚡ HIGH SURGE</span>`;
          } else if (r.surge_level === 'ELEVATED') {
            surgeBadge = `<span class="px-2 py-0.5 rounded font-medium bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">ELEVATED</span>`;
          } else {
            surgeBadge = `<span class="text-slate-500">NORMAL</span>`;
          }

          let etaClass = 'text-slate-300';
          if (r.delivery_eta.includes('BLOCKED')) {
            etaClass = 'text-red-400 font-bold';
          } else if (r.delivery_eta.includes('Rerouted') || r.delivery_eta.includes('Escort')) {
            etaClass = 'text-amber-400 font-medium';
          }

          let powerDetail = '';
          if (r.power_status === 'generator') {
            powerDetail = `<span class="text-amber-400 font-semibold"><i class="fa-solid fa-gas-pump mr-1"></i>${r.generator_fuel_l} L (~${r.generator_runtime_hours} hrs)</span>`;
          } else if (r.power_status === 'blackout') {
            powerDetail = `<span class="text-red-400 font-bold"><i class="fa-solid fa-battery-empty mr-1"></i>0 hrs (Refuel Urgent)</span>`;
          } else {
            powerDetail = `<span class="text-emerald-400"><i class="fa-solid fa-bolt mr-1"></i>Grid Active (${r.generator_fuel_l}L reserve)</span>`;
          }

          tr.innerHTML = `
            <td class="py-3 px-3.5">
              <div class="font-bold text-white text-xs">${r.store_id} - ${r.city}</div>
              <div class="text-[11px] text-slate-400">${r.address}</div>
              <div class="mt-1 flex items-center">${commsIcon} ${powerIcon}</div>
            </td>
            <td class="py-3 px-3 font-semibold text-slate-200">
              <span class="text-sm font-bold text-yellow-400">${r.dist_frontline_km}</span> km
            </td>
            <td class="py-3 px-3">${zoneBadge}</td>
            <td class="py-3 px-3 text-[11px]">
              <div>${surgeBadge}</div>
              <div class="text-slate-300 font-medium mt-1">${r.surge_category}</div>
            </td>
            <td class="py-3 px-3 text-[11px] ${etaClass}">
              <i class="fa-solid fa-truck mr-1"></i>${r.delivery_eta}
            </td>
            <td class="py-3 px-3 text-[11px]">
              ${powerDetail}
            </td>
            <td class="py-3 px-3 text-[11px] text-slate-300 font-medium">
              <i class="fa-solid fa-boxes-stacked text-yellow-400 mr-1.5"></i>${r.priority_restock}
            </td>
          `;
        }

        tbody.appendChild(tr);
      });
    }

    async function confirmShelter(storeId) {
      try {
        await fetch(`/api/stores/${storeId}/acknowledge`, { method: 'POST' });
        await loadData();
      } catch (err) {
        console.error("Ack error:", err);
      }
    }

    async function resetAck(storeId) {
      try {
        await fetch(`/api/stores/${storeId}/reset-ack`, { method: 'POST' });
        await loadData();
      } catch (err) {
        console.error("Reset ack error:", err);
      }
    }

    function setZoneFilter(zone) {
      activeZoneFilter = zone;
      document.querySelectorAll('.filter-btn').forEach(b => {
        b.className = 'filter-btn px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 text-slate-400 hover:bg-slate-700';
      });
      const activeBtn = document.getElementById('btn-zone-' + zone);
      if (activeBtn) {
        activeBtn.className = 'filter-btn px-2.5 py-1 rounded-lg text-xs font-bold bg-yellow-500 text-slate-950 shadow';
      }
      renderTable();
    }

    function toggleAlarmOnly() {
      alarmOnlyFilter = document.getElementById('alarm-toggle').checked;
      renderTable();
    }

    function handleSearch() {
      searchQuery = document.getElementById('search-input').value;
      renderTable();
    }

    async function refreshData() {
      const icon = document.getElementById('refresh-icon');
      icon.classList.add('fa-spin');
      try {
        await fetch('/api/refresh', { method: 'POST' });
        await loadData();
      } finally {
        setTimeout(() => icon.classList.remove('fa-spin'), 600);
      }
    }

    loadData();
    setInterval(loadData, 15000);
  </script>
</body>
</html>
"""


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)
