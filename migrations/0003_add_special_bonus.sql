-- 特別ポイント受け取り記録テーブル
CREATE TABLE IF NOT EXISTS special_bonus_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  bonus_type TEXT NOT NULL, -- 'maintenance_2026_02_16' など
  points INTEGER NOT NULL,
  claimed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE(user_id, bonus_type) -- 同じユーザーが同じボーナスを複数回受け取れないように
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_special_bonus_user_id ON special_bonus_claims(user_id);
CREATE INDEX IF NOT EXISTS idx_special_bonus_type ON special_bonus_claims(bonus_type);
