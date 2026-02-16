-- GOLD10 signals table
CREATE TABLE IF NOT EXISTS gold10_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  candle_timestamp INTEGER NOT NULL,
  price REAL NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_gold10_signals_timestamp ON gold10_signals(candle_timestamp);
CREATE INDEX IF NOT EXISTS idx_gold10_signals_active ON gold10_signals(is_active);
