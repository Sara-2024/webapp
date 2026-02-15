-- ティックデータテーブル（実際のマーケットのティックを模擬）
CREATE TABLE IF NOT EXISTS gold10_ticks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,  -- UNIXタイムスタンプ（秒単位）
  price REAL NOT NULL,          -- ティック価格
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- タイムスタンプにインデックス（高速検索用）
CREATE INDEX IF NOT EXISTS idx_gold10_ticks_timestamp ON gold10_ticks(timestamp);

-- 30秒区間の検索を高速化
CREATE INDEX IF NOT EXISTS idx_gold10_ticks_timestamp_price ON gold10_ticks(timestamp, price);
