CREATE TABLE IF NOT EXISTS decisions (
  action_id TEXT PRIMARY KEY,
  decision TEXT NOT NULL,
  reason TEXT,
  value REAL,
  decided_at TEXT NOT NULL
);
