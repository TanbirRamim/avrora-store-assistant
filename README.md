# Avrora Store Assistant

A daily action list for retail store managers: what to reorder, discount, move or follow up today, and why.
Built for the BIP 2026 "Problem Solving Through Generative AI" challenge set by Avrora.

The operational store data in this repository is synthetic. It describes one fictional store and contains no real company data. The separate Ukraine map combines Avrora's public store locator, public company sources and OpenStreetMap data, and is labelled accordingly.

## Structure

- `backend/` – Python: synthetic dataset, analytics, action engine, AI layer, API
- `frontend/` – Next.js web app for store managers, including the Avrora stores and supply network map
- `docs/ukraine-commercial-map.md` – map implementation, data files, sources, methodology and licence
- `cloudflare/` – Worker that hosts the app on Cloudflare, with decisions in D1

## Avrora stores and Ukraine supply network

Open **Map** in the app to explore 7,561 points in Ukraine: 1,935 official Avrora stores, 17 Avrora logistics sites, partners and manufacturers, and from OpenStreetMap 5,320 warehouses, 8 logistics/distribution centres and 281 food-production, beverage and grain sites. No other retail chains are shown. The map is a MapLibre component (`frontend/src/components/NetworkMap.tsx`) with filters, search and clustering. The data files are in `frontend/public/map/`. Sources, data dates and methodology are documented in [`docs/ukraine-commercial-map.md`](docs/ukraine-commercial-map.md).

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
cp .env.example .env            # fill AI_BASE_URL, AI_MODEL, AI_API_KEY (see "Set up the AI"), or leave empty
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

## Set up the AI

The AI texts (briefing, questions, supplier drafts, re-plan, team notes) use the store's own model through any
OpenAI-compatible chat-completions API. The browser calls `POST /api/ai/chat` on this app; the server adds the key
and forwards to `{AI_BASE_URL}/chat/completions`, so the key never reaches the browser and AI works for everyone,
all the time. `GET /api/ai/status` returns `{configured, model}`. Without it set up, or when the model fails, the
app uses its fixed rules.

Live site (Cloudflare Worker):

1. In `cloudflare/wrangler.jsonc`, set `vars.AI_BASE_URL` (the part before `/chat/completions`, e.g.
   `https://your-host/v1`) and `vars.AI_MODEL`.
2. Store the key as a secret (it is never written to a file):
   ```bash
   cd cloudflare
   npx wrangler secret put AI_API_KEY      # paste the key when asked
   npm run deploy
   ```
   For `wrangler dev`, put `AI_API_KEY=…` in `cloudflare/.dev.vars` (git-ignored).

Local API (FastAPI): set `AI_BASE_URL`, `AI_MODEL` and `AI_API_KEY` in `backend/.env` (git-ignored; copy
`backend/.env.example`) and start it with `uv run --env-file .env …` as above.

One device only: **More → AI settings → Use my own key** saves a base URL, model and key in that browser and uses
it instead of the store AI there (the provider must allow browser requests). **Remove my key** deletes it.

To test a deployed copy: `cd frontend && BASE_URL=https://… npx playwright test`.

## Live conditions

`GET /api/signals` reports scheduled power cuts, air-raid alerts and notable weather (frost, heat, storm) for the
store; Today shows them above the store note, and **Re-plan for this** reorders the day's five priorities around a
power cut or an alert (AI model when set up, rules without). The cron job pushes power cuts from 2 hours ahead.

- Power: `cloudflare/src/outages.json`, copied by hand from the Vinnytsiaoblenergo schedule (its site blocks
  requests from outside Ukraine). While `"example": true` the windows are placeholders and are labelled as such.
- Air-raid alerts: alerts.in.ua when `ALERTS_IN_UA_TOKEN` is set (`wrangler secret put ALERTS_IN_UA_TOKEN`);
  otherwise only simulated alerts.
- Weather: Open-Meteo, CC BY 4.0.

Demo simulation (needs the `DEMO_KEY` secret; locally it is in `cloudflare/.dev.vars`):

```bash
curl -X POST https://…/api/signals/simulate -H "X-Demo-Key: $DEMO_KEY" -d '{"kind":"power","minutes":240,"starts_in":90}'
curl -X POST https://…/api/signals/simulate -H "X-Demo-Key: $DEMO_KEY" -d '{"kind":"air_alert","minutes":45}'
curl -X DELETE https://…/api/signals/simulate -H "X-Demo-Key: $DEMO_KEY"
```

A simulated event is pushed to subscribed phones straight away and marked "Simulated" in the app.

## How it decides

1. **Analytics (deterministic):** a 28-day forecast per product, adjusted for weekday, promotions and disrupted days;
   days of cover, safety stock and order quantity in whole cases.
2. **Action engine (deterministic):** reorder, mark down, move to front and chase delivery, each with the money at stake.
3. **AI briefing:** a language model picks today's five and explains them. Every number it writes is checked against
   the engine's figures; anything unverifiable falls back to the engine's own text.
4. **The manager decides:** approve, adjust or dismiss. Every decision is logged.

The synthetic dataset contains 20 planted problems. `GET /api/evaluation` reports how many the engine finds.
The synthetic dataset contains 20 planted problems. `GET /api/evaluation` reports how many the engine finds.

## War-time map

**Map → War-time** rates 13 sample Avrora stores by distance to the front line and, when connected, live
air-raid alerts: a risk grade, what the manager should do now, shelter, generator runtime, next delivery and the
goods people will ask for. The logic is ported from `war-map-monitor/` into `frontend/src/lib/wartime.ts` and drawn
as a mode of the same MapLibre map.

- The stores (`frontend/public/map/wartime-stores.json`) are illustrative, not real Avrora data.
- The front line (`frontend/public/map/wartime-lines.geojson`) is a hand-drawn sketch with 25/65/120 km bands,
  not a live or current map. The app says so on screen.
- Air-raid alerts come from [alerts.in.ua](https://alerts.in.ua) through `GET /api/wartime/alerts` (Worker and
  FastAPI) only when `ALERTS_IN_UA_TOKEN` is set (`wrangler secret put ALERTS_IN_UA_TOKEN`, or `backend/.env`).
  Without it the app says alerts are not connected and rates stores by distance only. Nothing is simulated.

### Standalone monitor prototype (war-map-monitor/)

The original Python prototype: a FastAPI dashboard, a console monitor and CSV/JSON/Excel threat sheets.

- Reads front-line geometry from a community mirror of DeepStateMap data and alerts from alerts.in.ua.
- Tracks all 1,935 active Avrora stores. Its API says whether alerts are community-level, oblast-level or simulated, and whether the front line is current, cached or sample data.
- Without `ALERTS_IN_UA_TOKEN` it **simulates** random alerts; its output files are from such a simulated run.

```bash
cd war-map-monitor
pip install -r requirements.txt
python server.py       # dashboard at http://localhost:8000
python monitor.py      # console monitor
```
