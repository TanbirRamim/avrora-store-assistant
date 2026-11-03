# Avrora Store Assistant

A daily action list for retail store managers: what to reorder, discount, move or follow up today, and why.
Built for the BIP 2026 "Problem Solving Through Generative AI" challenge set by Avrora.

The operational store data in this repository is synthetic. It describes one fictional store and contains no real company data. The separate Ukraine network map uses public OpenStreetMap data and is labelled accordingly.

## Structure

- `backend/` – Python: synthetic dataset, analytics, action engine, AI layer, API
- `frontend/` – Next.js web app for store managers, including the Ukraine commercial network map
- `docs/ukraine-commercial-map.md` – map implementation, data files, sources, methodology and licence
- `cloudflare/` – Worker that hosts the app on Cloudflare, with decisions in D1

## Ukraine commercial network map

Open **Map** in the app to explore 6,211 public OpenStreetMap locations: 883 department stores, 5,320 warehouses and 8 logistics/distribution centres. The map is a MapLibre component (`frontend/src/components/NetworkMap.tsx`) with category filters, search and clustering. The full export is in `frontend/public/map/` as CSV and GeoJSON. Its dated data snapshot and methodology are documented in [`docs/ukraine-commercial-map.md`](docs/ukraine-commercial-map.md).

## Backend quick start

```bash
cd backend
uv sync
uv run python -m avrora.data.generate   # writes backend/data/*.csv
uv run pytest
```

## Run the app

```bash
# terminal 1 – API on :8000
cd backend
cp .env.example .env            # add your Open WebUI key, or set AVRORA_LLM=none
uv run --env-file .env uvicorn avrora.api.main:app --port 8000

# terminal 2 – web app on :3000
cd frontend
npm install
npm run dev
```

Open http://localhost:3000. Without an AI key the app still works: priorities are ranked by the rules engine and
explained with template text.

## Live demo

https://avrora-store-assistant.tanbirramim420.workers.dev

The store data is fixed, so the deployment needs no Python server. `python -m avrora.export` writes every read-only
API response to `cloudflare/src/snapshot.json`; the Worker serves those, keeps decisions in D1, and serves the
static build of the web app.

```bash
cd cloudflare
npm install
npm run deploy                  # export snapshot, build the web app, apply D1 migrations, deploy
```

AI briefing on the live site: open **Write with AI** under the day's summary and paste an Open WebUI API key. The
browser calls the OTH server directly, so the key never reaches Cloudflare. The OTH server only accepts connections
from the university network, so this needs campus Wi-Fi or the OTH VPN; without it the app uses the rules text.

To test a deployed copy: `cd frontend && BASE_URL=https://… npx playwright test`.

## How it decides

1. **Analytics (deterministic):** a 28-day forecast per product, adjusted for weekday, promotions and disrupted days;
   days of cover, safety stock and order quantity in whole cases.
2. **Action engine (deterministic):** reorder, mark down, move to front and chase delivery, each with the money at stake.
3. **AI briefing:** a language model picks today's five and explains them. Every number it writes is checked against
   the engine's figures; anything unverifiable falls back to the engine's own text.
4. **The manager decides:** approve, adjust or dismiss. Every decision is logged.

The synthetic dataset contains 20 planted problems. `GET /api/evaluation` reports how many the engine finds.


## Real-Time War Threat & Logistics Monitor (war-map-monitor/)

Real-time situational intelligence and dual-mode data sheet system for Avrora store managers and supply chain dispatchers across Ukraine.

- **War Map Ingestion**: Reads frontline geometry from DeepStateMap OSINT telemetry and community siren alerts from lerts.in.ua.
- **Life Safety View**: Air raid alerts, nuanced manager action directives, exact walking distance to verified bunkers, and store manager evacuation acknowledgment loop.
- **Logistics & Supply View**: Crisis surge demand forecasting (batteries, powerbanks, water), truck delivery ETAs & route safety, and generator fuel runtime tracking.
- **Multi-Format Exports**: Real-time synchronized multi-tab Excel (vrora_war_threat_sheet.xlsx), UTF-8-BOM CSV, and REST API.

`ash
cd war-map-monitor
python server.py       # Web Dashboard at http://localhost:8000
python monitor.py      # Real-time console monitor
`
