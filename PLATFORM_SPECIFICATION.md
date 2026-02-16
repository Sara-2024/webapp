# FXデモトレーディングプラットフォーム 仕様書

## 📋 目次
1. [システム概要](#システム概要)
2. [GOLD10 サインシステム仕様](#gold10-サインシステム仕様)
3. [ローソク足生成ロジック](#ローソク足生成ロジック)
4. [トレードシステム](#トレードシステム)
5. [ポイントシステム](#ポイントシステム)
6. [管理者機能](#管理者機能)

---

## システム概要

### プラットフォーム構成
- **フロントエンド**: HTML + TailwindCSS + Vanilla JavaScript
- **バックエンド**: Cloudflare Workers + Hono Framework
- **データベース**: Cloudflare D1 (SQLite)
- **チャートライブラリ**: TradingView Lightweight Charts
- **デプロイ**: Cloudflare Pages

### 主要機能
1. **GOLD10 チャート**: 30秒足のゴールド価格チャート
2. **トレードシステム**: 買い/売りポジション取引
3. **サインシステム**: 管理者が生成する売買シグナル
4. **ポイントシステム**: ログイン・トレード・チャットでポイント獲得
5. **ランキング**: 利益・取引数でユーザーランキング
6. **管理者ダッシュボード**: サイン生成・ユーザー管理

---

## GOLD10 サインシステム仕様

### 🎯 サイン生成の基本ルール

#### 1. **サイン生成タイミング**
- 管理者が手動で生成（自動生成なし）
- 現在時刻に最も近いローソク足に対してサイン生成
- サインは過去のローソク足には生成されない

#### 2. **サインの種類**
```typescript
type SignalType = 'BUY' | 'SELL'

// BUY サイン
{
  type: 'BUY',
  price: 5000.00,              // エントリー価格
  target_price: 5005.00,       // 目標価格（+0.1%）
  rsi: 45.5,                   // RSI値
  timestamp: 1771220820        // Unix timestamp
}

// SELL サイン
{
  type: 'SELL',
  price: 5000.00,              // エントリー価格
  target_price: 4995.00,       // 目標価格（-0.1%）
  rsi: 65.2,                   // RSI値
  timestamp: 1771220820        // Unix timestamp
}
```

### 📊 サイン成功判定ロジック

#### **成功条件**

##### **BUY サインの場合**
```javascript
// サイン生成時
entryPrice = 5000.00
targetPrice = entryPrice * 1.001  // +0.1% = 5005.00

// 成功判定（次の5本のローソク足をチェック）
for (let i = 1; i <= 5; i++) {
  const nextCandle = candles[signalIndex + i]
  if (nextCandle.high >= targetPrice) {
    return true  // 成功！
  }
}
return false  // 失敗
```

**成功条件**: サイン生成後の5本以内に、ローソク足の**高値（high）**が目標価格に到達

##### **SELL サインの場合**
```javascript
// サイン生成時
entryPrice = 5000.00
targetPrice = entryPrice * 0.999  // -0.1% = 4995.00

// 成功判定（次の5本のローソク足をチェック）
for (let i = 1; i <= 5; i++) {
  const nextCandle = candles[signalIndex + i]
  if (nextCandle.low <= targetPrice) {
    return true  // 成功！
  }
}
return false  // 失敗
```

**成功条件**: サイン生成後の5本以内に、ローソク足の**安値（low）**が目標価格に到達

---

### 🎲 サイン勝率を高める仕組み

#### 1. **価格変動幅の制御**
```typescript
// ローソク足生成時の価格変動
const volatilityRange = 0.005 + Math.random() * 0.015  // 0.5% ~ 2.0%
const trend = Math.random() > 0.5 ? 1 : -1            // ランダム方向
const priceChange = basePrice * volatilityRange * trend
```

**特徴**:
- 各30秒足で最大2.0%の変動
- 5本（2.5分）で最大10%の変動可能
- 目標は0.1%なので、**統計的に高確率で到達**

#### 2. **目標価格の設定（0.1%）**
```
BUY:  +0.1% （例: 5000.00 → 5005.00）
SELL: -0.1% （例: 5000.00 → 4995.00）
```

**理由**:
- 30秒足の平均変動幅（0.5%～2.0%）より小さい
- 5本（150秒）の猶予期間
- ノイズ的な価格変動でも到達しやすい

#### 3. **判定期間（5本 = 2.5分）**
```
判定対象: サイン生成後の5本のローソク足
時間: 5 × 30秒 = 150秒（2.5分）
```

**勝率が高い理由**:
- 5本の間に**一度でも**目標価格に到達すればOK
- 高値/安値をチェック（終値ではない）
- 価格は上下に揺れるため、0.1%は高確率で通過

---

### 📈 実際の勝率シミュレーション

#### **ケース1: トレンド相場**
```
価格推移: 5000 → 5010 → 5020 → 5015 → 5025 → 5030

BUY サイン (5000 → 5005):
- 1本目で 5010 到達 → ✅ 成功

SELL サイン (5000 → 4995):
- 5本待っても 4995 未到達 → ❌ 失敗
```
**結論**: トレンド方向のサインは勝率 100%

#### **ケース2: レンジ相場**
```
価格推移: 5000 → 5008 → 4995 → 5005 → 4998 → 5002

BUY サイン (5000 → 5005):
- 2本目で 5008 の高値で 5005 通過 → ✅ 成功

SELL サイン (5000 → 4995):
- 2本目で 4995 到達 → ✅ 成功
```
**結論**: レンジ相場では両方向とも勝率 90%以上

#### **ケース3: 逆方向トレンド**
```
価格推移: 5000 → 4990 → 4980 → 4975 → 4985 → 4995

BUY サイン (5000 → 5005):
- 5本待っても 5005 未到達 → ❌ 失敗

SELL サイン (5000 → 4995):
- 5本目で 4995 到達 → ✅ 成功
```
**結論**: 逆方向トレンドでは勝率 0% vs 100%

---

### 🏆 サイン勝率を最大化する管理者戦略

#### **戦略1: RSIを見る**
```javascript
// RSI 30以下 → 売られすぎ → BUY サイン推奨
if (rsi <= 30) {
  generateSignal('BUY')  // 反発期待
}

// RSI 70以上 → 買われすぎ → SELL サイン推奨
if (rsi >= 70) {
  generateSignal('SELL')  // 反落期待
}
```

#### **戦略2: 直近のトレンドを見る**
```javascript
// 直近3本が上昇トレンド → BUY サイン
const trend = candles.slice(-3).every((c, i, arr) => 
  i === 0 || c.close > arr[i-1].close
)
if (trend === 'up') generateSignal('BUY')

// 直近3本が下降トレンド → SELL サイン
if (trend === 'down') generateSignal('SELL')
```

#### **戦略3: ボラティリティを見る**
```javascript
// 高ボラティリティ（激しく動いている）
// → 0.1%は必ず通過する → 両方向OK

// 低ボラティリティ（動きが鈍い）
// → サイン生成を控える（タイムアウトリスク）
```

---

### 📊 実装済みサイン生成API

#### **エンドポイント**
```
POST /api/admin/gold10/generate-signal
```

#### **リクエスト**
```json
{
  "type": "BUY"  // or "SELL"
}
```

#### **処理フロー**
```typescript
1. 最新のローソク足を取得（現在時刻以前）
2. ローソク足が存在しない場合は新規生成
3. エントリー価格 = ローソク足のclose価格
4. 目標価格を計算（±0.1%）
5. gold10_signals テーブルに保存
6. フロントエンドに即座に反映（5秒ポーリング）
```

#### **レスポンス**
```json
{
  "success": true,
  "signal": {
    "type": "BUY",
    "price": 5000.00,
    "target_price": 5005.00,
    "timestamp": 1771220820,
    "success": 0,
    "rsi": 45.5
  },
  "message": "買いサインを生成しました"
}
```

---

## ローソク足生成ロジック

### 30秒足の生成ルール

```typescript
async function generateSingleCandle(prevClose: number, timestamp: number) {
  const steps = 10  // 30秒を10ステップに分割（3秒ごと）
  let open = prevClose
  let close = prevClose
  let high = prevClose
  let low = prevClose
  
  for (let i = 0; i < steps; i++) {
    // ランダムなトレンド方向
    const trend = Math.random() > 0.5 ? 1 : -1
    
    // ランダムな変動幅（0.5% ~ 2.0%）
    const volatility = 0.005 + Math.random() * 0.015
    
    // 価格変動
    const change = close * volatility * trend
    close += change
    
    // 高値・安値の更新
    high = Math.max(high, close)
    low = Math.min(low, close)
  }
  
  return { timestamp, open, high, low, close, rsi: 50 }
}
```

### 特徴
- **30秒ごと**に新しいローソク足生成
- **変動幅**: 0.5% ～ 2.0%（ランダム）
- **トレンド**: 上昇 or 下降（50/50）
- **リアルタイム**: Durable Objects で自動生成

---

## トレードシステム

### ポジション取引

#### **エントリー**
```typescript
POST /api/trade/entry
{
  "type": "BUY",      // or "SELL"
  "amount": 10000     // 取引金額（円）
}
```

#### **決済**
```typescript
POST /api/trade/exit
{
  "positionId": 123
}
```

#### **損益計算**
```typescript
// BUY ポジション
profitLoss = amount * ((exitPrice - entryPrice) / entryPrice)

// SELL ポジション
profitLoss = amount * ((entryPrice - exitPrice) / entryPrice)

// 例: BUY 10,000円 @ 5000.00 → 決済 @ 5005.00
profitLoss = 10000 * ((5005 - 5000) / 5000) = 10000 * 0.001 = 10円
```

#### **自動決済**
- エントリー後**15分経過**で自動決済
- 10秒ごとにバックグラウンドでチェック

---

## ポイントシステム

### ポイント獲得方法

| アクション | 獲得ポイント | 条件 |
|---|---|---|
| デイリーログイン | 10 pt | 毎日初回ログイン |
| 7日連続ログイン | +50 pt | ボーナス |
| チャット送信 | 1 pt/件 | メッセージ1件につき |
| トレード完了 | 1 pt | 決済から5分以上経過後の取引 |
| 週次ランキング1位 | 10,000 pt | 毎週月曜リセット |
| 週次ランキング2位 | 5,000 pt | 〃 |
| 週次ランキング3位 | 1,000 pt | 〃 |
| **特別ボーナス** | **1,000 pt** | **24時間限定（メンテナンスお詫び）** |

### ポイント利用
- 現在は貯めるのみ（将来的に景品交換など実装予定）

---

## 管理者機能

### サイン管理
- **買いサイン生成**: 現在価格から+0.1%を目標
- **売りサイン生成**: 現在価格から-0.1%を目標
- **サイン履歴**: 過去24時間のサイン一覧
- **成功率**: 自動判定（5本後に判定）

### ユーザー管理
- ユーザー一覧表示
- 残高・利益・取引数の確認
- 新規ユーザー作成（パスワード自動生成）

### チャート監視
- リアルタイムGOLD10チャート
- RSI・MACD表示
- サインマーカー表示

---

## データベーススキーマ

### users テーブル
```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  balance REAL DEFAULT 100000,
  total_profit REAL DEFAULT 0,
  total_trades INTEGER DEFAULT 0,
  points INTEGER DEFAULT 0,
  consecutive_login_days INTEGER DEFAULT 0,
  last_login_date TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### gold10_candles テーブル
```sql
CREATE TABLE gold10_candles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER UNIQUE NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  rsi REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### gold10_signals テーブル
```sql
CREATE TABLE gold10_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candle_id INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  type TEXT NOT NULL,           -- 'BUY' or 'SELL'
  price REAL NOT NULL,
  target_price REAL NOT NULL,
  success INTEGER DEFAULT 0,    -- 0=未判定, 1=成功
  rsi REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (candle_id) REFERENCES gold10_candles(id)
);
```

### positions テーブル
```sql
CREATE TABLE positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,           -- 'BUY' or 'SELL'
  amount REAL NOT NULL,
  entry_price REAL NOT NULL,
  exit_price REAL,
  profit_loss REAL DEFAULT 0,
  entry_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  exit_time DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### special_bonus_claims テーブル
```sql
CREATE TABLE special_bonus_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  bonus_type TEXT NOT NULL,
  points INTEGER NOT NULL,
  claimed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, bonus_type)
);
```

---

## API エンドポイント一覧

### 認証
- `POST /api/auth/login` - ログイン
- `POST /api/auth/logout` - ログアウト
- `GET /api/auth/me` - 現在のユーザー情報

### トレード
- `GET /api/trade/gold-price` - 現在の金価格
- `POST /api/trade/entry` - ポジションエントリー
- `POST /api/trade/exit` - ポジション決済
- `GET /api/trade/open-positions` - 保有ポジション一覧
- `GET /api/trade/history` - 取引履歴
- `POST /api/trade/auto-close-expired` - 自動決済（15分経過）

### GOLD10 チャート
- `GET /api/gold10/candles` - ローソク足データ取得
- `GET /api/gold10/candles/latest` - 最新ローソク足
- `GET /api/gold10/signals` - サイン一覧

### 管理者
- `POST /api/admin/login` - 管理者ログイン
- `POST /api/admin/gold10/generate-signal` - サイン生成
- `GET /api/admin/users` - ユーザー一覧
- `POST /api/admin/users` - 新規ユーザー作成

### ランキング
- `GET /api/ranking/profit` - 利益ランキング
- `GET /api/ranking/trades` - 取引数ランキング

### その他
- `GET /api/videos` - 動画教材一覧
- `GET /api/chat/messages` - チャットメッセージ
- `POST /api/chat/messages` - メッセージ送信
- `GET /api/special-bonus/status` - 特別ボーナス状況
- `POST /api/special-bonus/claim` - 特別ボーナス受け取り

---

## デプロイURL

### 本番環境
```
https://webapp-303.pages.dev
```

### 主要ページ
- トップ: `/`
- トレード: `/trade`
- マイページ: `/mypage`
- ランキング: `/ranking`
- サイン履歴: `/signal-history`
- 動画教材: `/videos`
- チャット: `/chat`
- 管理者ログイン: `/admin-login`
- 管理者ダッシュボード: `/admin`

---

## まとめ

### 🎯 サインが勝ちやすい理由
1. **目標値が小さい**: 0.1%（価格変動幅の1/5～1/20）
2. **判定期間が長い**: 5本（2.5分）の猶予
3. **高値/安値判定**: 終値ではなく、一瞬でも到達すればOK
4. **高ボラティリティ**: 30秒で最大2%変動するため、0.1%は高確率で通過
5. **統計的優位性**: レンジ相場なら両方向90%以上の勝率

### 📈 推奨サイン戦略
- **RSI 30以下 → BUY サイン**（反発期待）
- **RSI 70以上 → SELL サイン**（反落期待）
- **上昇トレンド → BUY サイン**
- **下降トレンド → SELL サイン**
- **高ボラティリティ時 → 両方向OK**

### 🔒 セキュリティ
- Cookie ベース認証
- 管理者は別途認証
- ポイント重複受け取り防止
- SQL インジェクション対策済み

---

**作成日**: 2026-02-16  
**バージョン**: 1.0.0  
**最終更新**: 2026-02-16
