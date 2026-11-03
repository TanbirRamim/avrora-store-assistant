-- Phones that turned on notifications.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Which signal was already sent to which phone, so the cron job never repeats an alert.
CREATE TABLE IF NOT EXISTS push_sent (
  endpoint TEXT NOT NULL,
  signal_key TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (endpoint, signal_key)
);
