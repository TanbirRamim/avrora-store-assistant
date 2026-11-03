-- Demo-only events created with POST /api/signals/simulate; they expire on their own.
CREATE TABLE IF NOT EXISTS simulated_signals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,          -- power | air_alert
  starts_at TEXT NOT NULL,     -- ISO 8601, UTC
  ends_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- When a live air-raid alert was first seen. The alerts.in.ua status feed has no start time,
-- so this gives each alert a stable start for display and push dedupe.
CREATE TABLE IF NOT EXISTS alert_state (
  region TEXT PRIMARY KEY,
  status TEXT NOT NULL,        -- A (whole oblast) or P (part of it)
  since TEXT NOT NULL
);
