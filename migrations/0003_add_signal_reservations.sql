-- サイン予約テーブル
CREATE TABLE IF NOT EXISTS gold10_signal_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,  -- 'BUY' or 'SELL'
  reserve_time INTEGER NOT NULL,  -- UNIXタイムスタンプ（予約実行時刻）
  created_at INTEGER DEFAULT (strftime('%s', 'now')),  -- 予約作成時刻
  executed INTEGER DEFAULT 0,  -- 実行済みフラグ（0: 未実行, 1: 実行済み）
  executed_at INTEGER  -- 実行時刻
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_reservations_reserve_time ON gold10_signal_reservations(reserve_time);
CREATE INDEX IF NOT EXISTS idx_reservations_executed ON gold10_signal_reservations(executed);
