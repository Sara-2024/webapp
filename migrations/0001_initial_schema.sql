-- Users table
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  password TEXT NOT NULL,
  username TEXT NOT NULL,
  balance REAL DEFAULT 1000000.0,
  total_profit REAL DEFAULT 0.0,
  total_trades INTEGER DEFAULT 0,
  points INTEGER DEFAULT 0,
  last_login_date TEXT,
  consecutive_login_days INTEGER DEFAULT 0,
  is_admin BOOLEAN DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Trades table
CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL, -- 'BUY' or 'SELL'
  amount REAL NOT NULL,
  entry_price REAL NOT NULL,
  exit_price REAL,
  profit_loss REAL,
  status TEXT DEFAULT 'OPEN', -- 'OPEN' or 'CLOSED'
  entry_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  exit_time DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Point transactions table
CREATE TABLE IF NOT EXISTS point_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  points INTEGER NOT NULL,
  type TEXT NOT NULL, -- 'DAILY_LOGIN', 'CONSECUTIVE_LOGIN', 'TRADE', 'RANKING'
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Videos table
CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  youtube_url TEXT NOT NULL,
  order_index INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Admin users table
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Chat messages table
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_trades_user_id ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_point_transactions_user_id ON point_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_users_total_profit ON users(total_profit DESC);
CREATE INDEX IF NOT EXISTS idx_users_total_trades ON users(total_trades DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at DESC);

-- Insert default admin user
INSERT INTO admin_users (email, password) VALUES ('kondo@leagan.group', 'Leagan-0000');

-- Insert default video
INSERT INTO videos (title, youtube_url, order_index) VALUES ('エントリーの基礎', 'https://youtu.be/pRlyBmJ_3Ks', 1);
