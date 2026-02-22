-- 週次履歴テーブル
CREATE TABLE IF NOT EXISTS weekly_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  week_start_date TEXT NOT NULL,
  week_end_date TEXT NOT NULL,
  final_balance REAL NOT NULL,
  total_profit REAL NOT NULL,
  total_trades INTEGER NOT NULL,
  ranking INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_weekly_history_user_id ON weekly_history(user_id);
CREATE INDEX IF NOT EXISTS idx_weekly_history_week_start ON weekly_history(week_start_date);
CREATE INDEX IF NOT EXISTS idx_weekly_history_ranking ON weekly_history(ranking);
