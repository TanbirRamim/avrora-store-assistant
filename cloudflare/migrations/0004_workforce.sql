-- Workforce plan audit trail: agent replans, manager approvals and rejections (same table as the local sqlite).
CREATE TABLE IF NOT EXISTS workforce_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,          -- plan date, YYYY-MM-DD
  version TEXT NOT NULL,       -- base | sick-E05 | air_alert-12 | power-12 | traffic_spike-12
  action TEXT NOT NULL,        -- drafted | approved | rejected
  by TEXT NOT NULL,            -- agent | manager
  summary TEXT NOT NULL,
  reason TEXT,
  at TEXT NOT NULL             -- ISO 8601, UTC
);
CREATE INDEX IF NOT EXISTS workforce_audit_date ON workforce_audit (date, id);
