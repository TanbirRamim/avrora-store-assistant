# Avrora Store Assistant

A daily action list for retail store managers: what to reorder, discount, move or follow up today, and why.
Built for the BIP 2026 "Problem Solving Through Generative AI" challenge set by Avrora.

All data in this repository is synthetic. It describes one fictional store and contains no real company data.

## Structure

- `backend/` – Python: synthetic dataset, analytics, action engine, AI layer, API
- `frontend/` – Next.js web app for store managers

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

## How it decides

1. **Analytics (deterministic):** a 28-day forecast per product, adjusted for weekday, promotions and disrupted days;
   days of cover, safety stock and order quantity in whole cases.
2. **Action engine (deterministic):** reorder, mark down, move to front and chase delivery, each with the money at stake.
3. **AI briefing:** a language model picks today's five and explains them. Every number it writes is checked against
   the engine's figures; anything unverifiable falls back to the engine's own text.
4. **The manager decides:** approve, adjust or dismiss. Every decision is logged.

The synthetic dataset contains 20 planted problems. `GET /api/evaluation` reports how many the engine finds.
