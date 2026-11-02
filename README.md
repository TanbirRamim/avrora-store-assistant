# Avrora Store Assistant

A daily action list for retail store managers: what to reorder, discount, move or follow up today, and why.
Built for the BIP 2026 "Problem Solving Through Generative AI" challenge set by Avrora.

All data in this repository is synthetic. It describes one fictional store and contains no real company data.

## Structure

- `backend/` – Python: synthetic dataset, analytics, action engine, AI layer, API
- `frontend/` – web app (in progress)

## Backend quick start

```bash
cd backend
uv sync
uv run python -m avrora.data.generate   # writes backend/data/*.csv
uv run pytest
```
