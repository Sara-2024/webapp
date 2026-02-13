-- GOLD10 練習チャート用テーブル

-- ローソク足データテーブル
CREATE TABLE IF NOT EXISTS gold10_candles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL UNIQUE,  -- Unix timestamp (1分足のタイムスタンプ)
  open REAL NOT NULL,                 -- 始値
  high REAL NOT NULL,                 -- 高値
  low REAL NOT NULL,                  -- 安値
  close REAL NOT NULL,                -- 終値
  rsi REAL,                           -- RSI値（14期間）
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- タイムスタンプでのクエリを高速化
CREATE INDEX IF NOT EXISTS idx_gold10_candles_timestamp ON gold10_candles(timestamp DESC);

-- 反転サインテーブル
CREATE TABLE IF NOT EXISTS gold10_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candle_id INTEGER NOT NULL,         -- ローソク足ID
  timestamp INTEGER NOT NULL,         -- サイン発生時刻
  type TEXT NOT NULL CHECK(type IN ('BUY', 'SELL')),  -- 買いサイン/売りサイン
  price REAL NOT NULL,                -- サイン発生価格
  target_price REAL,                  -- 目標価格（約5ドル先）
  success INTEGER DEFAULT NULL,       -- 勝ち(1)/負け(0)/未確定(NULL)
  rsi REAL,                           -- サイン時のRSI値
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (candle_id) REFERENCES gold10_candles(id) ON DELETE CASCADE
);

-- サイン検索用インデックス
CREATE INDEX IF NOT EXISTS idx_gold10_signals_timestamp ON gold10_signals(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_gold10_signals_candle_id ON gold10_signals(candle_id);

-- 初期データ生成用メタテーブル（システム管理用）
CREATE TABLE IF NOT EXISTS gold10_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 最終ローソク足生成時刻を記録
INSERT OR IGNORE INTO gold10_meta (key, value) VALUES ('last_candle_time', '0');
INSERT OR IGNORE INTO gold10_meta (key, value) VALUES ('base_price', '4950.0');
