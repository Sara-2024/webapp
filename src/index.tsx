import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'

type Bindings = {
  DB: D1Database
  TWELVE_DATA_API_KEY?: string
}

const app = new Hono<{ Bindings: Bindings }>()

// CORS設定
app.use('/api/*', cors())

// 静的ファイル配信
app.use('/static/*', serveStatic({ root: './public' }))

// ユーティリティ関数：ランダムなユーザー名生成
function generateRandomUsername(): string {
  const adjectives = ['賢い', '素早い', '勇敢な', '静かな', '強い', '優しい', '冷静な', '熱い']
  const nouns = ['トレーダー', 'パンダ', 'ドラゴン', 'タイガー', 'イーグル', 'フェニックス', 'ウルフ', 'ライオン']
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)]
  const noun = nouns[Math.floor(Math.random() * nouns.length)]
  const num = Math.floor(Math.random() * 1000)
  return `${adj}${noun}${num}`
}

// ユーティリティ関数：現在の金価格を取得（Twelve Data API使用 - XAU/USD）
async function getCurrentGoldPrice(apiKey?: string): Promise<number> {
  if (!apiKey) {
    // API Keyが設定されていない場合はダミー価格を返す
    return 4900 + Math.random() * 200
  }

  try {
    // Twelve Data APIでXAU/USD（ゴールドスポット）の価格を取得
    // XAU/USDはGOLD先物とほぼ同じ価格帯（$4,900-$5,100）
    const response = await fetch(
      `https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${apiKey}`
    )
    const data = await response.json()
    
    if (data.price) {
      const price = parseFloat(data.price)
      return price
    }
    
    // エラーの場合はダミー価格
    console.error('Twelve Data API error:', data)
    return 4900 + Math.random() * 200
  } catch (error) {
    console.error('Twelve Data API error:', error)
    return 4900 + Math.random() * 200
  }
}

// ユーティリティ関数：GOLD10の現在価格を取得（DBから最新のローソク足価格を取得）
async function getGold10Price(db: D1Database): Promise<number> {
  try {
    const latestCandle = await db.prepare(`
      SELECT close FROM gold10_candles
      ORDER BY timestamp DESC
      LIMIT 1
    `).first()

    if (latestCandle && latestCandle.close) {
      return latestCandle.close as number
    }

    // データがない場合はデフォルト値
    console.error('GOLD10: No candle data found')
    return 5000
  } catch (error) {
    console.error('GOLD10 price fetch error:', error)
    return 5000
  }
}

// キャッシュ用の価格データ
let cachedGoldPrice = 4950.0
let lastPriceUpdate = 0
const PRICE_CACHE_DURATION = 30000 // 30秒間キャッシュ（30秒ごとに実価格取得）

// ユーティリティ関数：ポイント付与
async function addPoints(db: D1Database, userId: number, points: number, type: string, description: string) {
  await db.prepare(`
    INSERT INTO point_transactions (user_id, points, type, description)
    VALUES (?, ?, ?, ?)
  `).bind(userId, points, type, description).run()

  await db.prepare(`
    UPDATE users SET points = points + ? WHERE id = ?
  `).bind(points, userId).run()
}

// ========== 認証API ==========

// ユーザーログイン
app.post('/api/auth/login', async (c) => {
  const { password } = await c.req.json()
  
  // パスワード検証：7文字、数字6文字+英字1文字
  if (!password || password.length !== 7) {
    return c.json({ error: 'パスワードは7文字（数字6桁+英字1文字）で入力してください' }, 400)
  }
  
  // 数字6文字と英字1文字を含むかチェック
  const digitCount = (password.match(/\d/g) || []).length
  const letterCount = (password.match(/[a-zA-Z]/g) || []).length
  
  if (digitCount !== 6 || letterCount !== 1) {
    return c.json({ error: 'パスワードは数字6桁と英字1文字を含む必要があります' }, 400)
  }

  const user = await c.env.DB.prepare(`
    SELECT * FROM users WHERE password = ?
  `).bind(password).first()

  if (!user) {
    return c.json({ error: 'ユーザーが見つかりません' }, 404)
  }

  // ログインボーナスチェック
  const today = new Date().toISOString().split('T')[0]
  const lastLogin = user.last_login_date as string | null
  
  if (lastLogin !== today) {
    // デイリーログインポイント
    await addPoints(c.env.DB, user.id as number, 10, 'DAILY_LOGIN', 'デイリーログイン')

    // 連続ログインチェック
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    let consecutiveDays = 1
    
    if (lastLogin === yesterday) {
      consecutiveDays = (user.consecutive_login_days as number) + 1
      if (consecutiveDays === 7) {
        await addPoints(c.env.DB, user.id as number, 50, 'CONSECUTIVE_LOGIN', '7日連続ログインボーナス')
        consecutiveDays = 0 // リセット
      }
    }

    await c.env.DB.prepare(`
      UPDATE users 
      SET last_login_date = ?, consecutive_login_days = ?
      WHERE id = ?
    `).bind(today, consecutiveDays, user.id).run()
  }

  // セッション設定
  setCookie(c, 'user_id', String(user.id), {
    httpOnly: true,
    secure: true,
    maxAge: 60 * 60 * 24 * 7 // 7日間
  })

  return c.json({ 
    success: true,
    user: {
      id: user.id,
      username: user.username,
      balance: user.balance,
      points: user.points
    }
  })
})

// 管理者ログイン
app.post('/api/auth/admin-login', async (c) => {
  const { email, password } = await c.req.json()

  const admin = await c.env.DB.prepare(`
    SELECT * FROM admin_users WHERE email = ? AND password = ?
  `).bind(email, password).first()

  if (!admin) {
    return c.json({ error: 'メールアドレスまたはパスワードが正しくありません' }, 401)
  }

  setCookie(c, 'admin_id', String(admin.id), {
    httpOnly: true,
    secure: true,
    maxAge: 60 * 60 * 24 // 24時間
  })

  return c.json({ success: true })
})

// ログアウト
app.post('/api/auth/logout', (c) => {
  deleteCookie(c, 'user_id')
  deleteCookie(c, 'admin_id')
  return c.json({ success: true })
})

// 現在のユーザー情報取得
app.get('/api/auth/me', async (c) => {
  const userId = getCookie(c, 'user_id')
  if (!userId) {
    return c.json({ error: '未認証' }, 401)
  }

  const user = await c.env.DB.prepare(`
    SELECT id, username, balance, total_profit, total_trades, points, consecutive_login_days
    FROM users WHERE id = ?
  `).bind(userId).first()

  if (!user) {
    return c.json({ error: 'ユーザーが見つかりません' }, 404)
  }

  return c.json(user)
})

// ========== トレードAPI ==========

// 現在の金価格取得
app.get('/api/trade/gold-price', async (c) => {
  const now = Date.now()
  const currentDate = new Date(now)
  
  // 現在の秒数を取得（0-59）
  const currentSeconds = currentDate.getSeconds()
  
  // 次の30秒区切りまでの秒数を計算
  // 0-29秒: 次は30秒、30-59秒: 次は0秒（次の分）
  const secondsUntilNext30 = currentSeconds < 30 
    ? 30 - currentSeconds 
    : 60 - currentSeconds
  
  // 最後のAPI取得から30秒以上経過しているか、または30秒区切りのタイミングか確認
  const timeSinceLastUpdate = now - lastPriceUpdate
  const shouldUpdate = timeSinceLastUpdate >= PRICE_CACHE_DURATION || lastPriceUpdate === 0
  
  // キャッシュが有効な場合は±10円のランダム変動を追加
  if (!shouldUpdate && timeSinceLastUpdate < PRICE_CACHE_DURATION) {
    // 円換算で±10円の変動を追加（$1あたり152.96円なので、ドル換算では±0.065ドル程度）
    const yenVariation = (Math.random() - 0.5) * 20 // -10円 ~ +10円
    const dollarVariation = yenVariation / 152.96  // 円をドルに変換
    const priceWithVariation = cachedGoldPrice + dollarVariation
    
    return c.json({ 
      price: priceWithVariation.toFixed(2),
      usdJpy: 152.96,
      timestamp: new Date().toISOString(),
      cached: true,
      nextUpdate: secondsUntilNext30
    })
  }
  
  // Twelve Data API Keyを環境変数から取得
  const apiKey = c.env.TWELVE_DATA_API_KEY || ''
  
  try {
    const price = await getCurrentGoldPrice(apiKey)
    cachedGoldPrice = price
    lastPriceUpdate = now
    
    return c.json({ 
      price: price.toFixed(2),
      usdJpy: 152.96,
      timestamp: new Date().toISOString(),
      cached: false,
      nextUpdate: 30
    })
  } catch (error) {
    // エラー時はキャッシュまたはダミー価格
    return c.json({ 
      price: cachedGoldPrice.toFixed(2),
      usdJpy: 152.96,
      timestamp: new Date().toISOString(),
      cached: true,
      error: 'API呼び出しエラー',
      nextUpdate: secondsUntilNext30
    })
  }
})

// ポジション開く（買う/売る）
app.post('/api/trade/open', async (c) => {
  const userId = getCookie(c, 'user_id')
  if (!userId) {
    return c.json({ error: '未認証' }, 401)
  }

  const { type, amount } = await c.req.json()
  
  if (type !== 'BUY' && type !== 'SELL') {
    return c.json({ error: '無効な取引タイプ' }, 400)
  }

  // GOLD10の最新価格を取得
  const latestCandle = await c.env.DB.prepare(`
    SELECT close FROM gold10_candles
    ORDER BY timestamp DESC
    LIMIT 1
  `).first()

  const entryPrice = latestCandle ? latestCandle.close as number : 5000

  const result = await c.env.DB.prepare(`
    INSERT INTO trades (user_id, type, amount, entry_price, status)
    VALUES (?, ?, ?, ?, 'OPEN')
  `).bind(userId, type, amount, entryPrice).run()

  return c.json({
    success: true,
    tradeId: result.meta.last_row_id,
    type,
    amount,
    entryPrice
  })
})

// ポジション決済
app.post('/api/trade/close/:tradeId', async (c) => {
  const userId = getCookie(c, 'user_id')
  if (!userId) {
    return c.json({ error: '未認証' }, 401)
  }

  const tradeId = c.req.param('tradeId')
  
  const trade = await c.env.DB.prepare(`
    SELECT * FROM trades WHERE id = ? AND user_id = ? AND status = 'OPEN'
  `).bind(tradeId, userId).first()

  if (!trade) {
    return c.json({ error: '取引が見つかりません' }, 404)
  }

  // GOLD10の最新価格を取得（決済価格）
  const exitPrice = await getGold10Price(c.env.DB)
  const entryPrice = trade.entry_price as number
  const amount = trade.amount as number
  const type = trade.type as string

  // 損益計算（GOLD10の場合、1ozあたりの価格差）
  let profitLoss = 0
  if (type === 'BUY') {
    profitLoss = (exitPrice - entryPrice) * amount * 152.96 // USD/JPY換算
  } else {
    profitLoss = (entryPrice - exitPrice) * amount * 152.96
  }

  const exitTime = new Date().toISOString()

  // トレード更新
  await c.env.DB.prepare(`
    UPDATE trades 
    SET exit_price = ?, profit_loss = ?, status = 'CLOSED', exit_time = ?
    WHERE id = ?
  `).bind(exitPrice, profitLoss, exitTime, tradeId).run()

  // ユーザーの残高と統計更新
  await c.env.DB.prepare(`
    UPDATE users 
    SET balance = balance + ?, 
        total_profit = total_profit + ?,
        total_trades = total_trades + 1
    WHERE id = ?
  `).bind(profitLoss, profitLoss, userId).run()

  // トレードポイント付与（5分以内の連続取引は対象外）
  const lastTrade = await c.env.DB.prepare(`
    SELECT exit_time FROM trades 
    WHERE user_id = ? AND status = 'CLOSED' AND id != ?
    ORDER BY exit_time DESC LIMIT 1
  `).bind(userId, tradeId).first()

  if (!lastTrade || !lastTrade.exit_time) {
    await addPoints(c.env.DB, Number(userId), 1, 'TRADE', 'トレード完了')
  } else {
    const lastExitTime = new Date(lastTrade.exit_time as string).getTime()
    const currentExitTime = new Date(exitTime).getTime()
    const diffMinutes = (currentExitTime - lastExitTime) / (1000 * 60)
    
    if (diffMinutes >= 5) {
      await addPoints(c.env.DB, Number(userId), 1, 'TRADE', 'トレード完了')
    }
  }

  return c.json({
    success: true,
    profitLoss,
    exitPrice,
    newBalance: (trade.balance as number) + profitLoss
  })
})

// 現在のオープンポジション取得
app.get('/api/trade/open-positions', async (c) => {
  const userId = getCookie(c, 'user_id')
  if (!userId) {
    return c.json({ error: '未認証' }, 401)
  }

  const { results } = await c.env.DB.prepare(`
    SELECT * FROM trades 
    WHERE user_id = ? AND status = 'OPEN'
    ORDER BY entry_time DESC
  `).bind(userId).all()

  return c.json(results)
})

// 取引履歴取得
app.get('/api/trade/history', async (c) => {
  const userId = getCookie(c, 'user_id')
  if (!userId) {
    return c.json({ error: '未認証' }, 401)
  }

  const { results } = await c.env.DB.prepare(`
    SELECT * FROM trades 
    WHERE user_id = ? AND status = 'CLOSED'
    ORDER BY exit_time DESC
    LIMIT 50
  `).bind(userId).all()

  return c.json(results)
})

// ========== GOLD10 API ==========

import { 
  generateCandle, 
  generateSignal, 
  calculateRSI, 
  shouldGenerateSignal,
  generateInitialCandles,
  generateInitialSignals,
  type Candle,
  type Signal
} from './gold10'

// 過去12時間分のローソク足データを取得
app.get('/api/gold10/candles', async (c) => {
  const hoursParam = c.req.query('hours') || '12'
  const hours = parseInt(hoursParam)
  const limit = hours * 60  // 1分足なので、時間 × 60本
  
  const candles = await c.env.DB.prepare(`
    SELECT * FROM gold10_candles
    ORDER BY timestamp DESC
    LIMIT ?
  `).bind(limit).all()

  // 新しい順→古い順に並び替え
  const sortedCandles = candles.results.reverse()
  
  return c.json(sortedCandles)
})

// 最新のローソク足データを取得
app.get('/api/gold10/latest', async (c) => {
  const latestCandle = await c.env.DB.prepare(`
    SELECT * FROM gold10_candles
    ORDER BY timestamp DESC
    LIMIT 1
  `).first()

  const latestSignals = await c.env.DB.prepare(`
    SELECT * FROM gold10_signals
    ORDER BY timestamp DESC
    LIMIT 10
  `).all()

  return c.json({
    candle: latestCandle,
    signals: latestSignals.results
  })
})

// サインデータを取得
app.get('/api/gold10/signals', async (c) => {
  const hoursParam = c.req.query('hours') || '3'
  const hours = parseInt(hoursParam)
  const timeLimit = Math.floor(Date.now() / 1000) - (hours * 3600)
  
  const signals = await c.env.DB.prepare(`
    SELECT * FROM gold10_signals
    WHERE timestamp >= ?
    ORDER BY timestamp ASC
  `).bind(timeLimit).all()

  return c.json(signals.results)
})

// 新しいローソク足とサインを生成（管理用エンドポイント - 本番では定期実行）
app.post('/api/gold10/generate', async (c) => {
  // 最新のローソク足を取得
  const latestCandle = await c.env.DB.prepare(`
    SELECT * FROM gold10_candles
    ORDER BY timestamp DESC
    LIMIT 1
  `).first() as Candle | null

  // 最新のサインを取得
  const latestSignal = await c.env.DB.prepare(`
    SELECT * FROM gold10_signals
    ORDER BY timestamp DESC
    LIMIT 1
  `).first() as Signal | null

  // 新しいローソク足を生成
  const newCandle = generateCandle(latestCandle, 4950)

  // ローソク足をDBに保存
  const insertResult = await c.env.DB.prepare(`
    INSERT INTO gold10_candles (timestamp, open, high, low, close)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    newCandle.timestamp,
    newCandle.open,
    newCandle.high,
    newCandle.low,
    newCandle.close
  ).run()

  const candleId = insertResult.meta.last_row_id

  // 過去14本のローソク足を取得してRSIを計算
  const recentCandles = await c.env.DB.prepare(`
    SELECT * FROM gold10_candles
    ORDER BY timestamp DESC
    LIMIT 15
  `).all()

  const candlesForRSI = recentCandles.results.reverse() as Candle[]
  const rsi = calculateRSI(candlesForRSI, 14)

  // RSIを更新
  await c.env.DB.prepare(`
    UPDATE gold10_candles SET rsi = ? WHERE id = ?
  `).bind(rsi, candleId).run()

  // サイン生成判定
  let newSignal: Signal | null = null
  const lastSignalTime = latestSignal ? latestSignal.timestamp : null
  
  if (shouldGenerateSignal(lastSignalTime)) {
    newSignal = generateSignal({ ...newCandle, rsi }, candleId as number, rsi)
    
    // サインをDBに保存
    await c.env.DB.prepare(`
      INSERT INTO gold10_signals (candle_id, timestamp, type, price, target_price, success, rsi)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      newSignal.candle_id,
      newSignal.timestamp,
      newSignal.type,
      newSignal.price,
      newSignal.target_price,
      newSignal.success,
      newSignal.rsi
    ).run()
  }

  return c.json({
    candle: { ...newCandle, id: candleId, rsi },
    signal: newSignal,
    message: '新しいローソク足とサインを生成しました'
  })
})

// 初期データ生成（初回のみ実行）
app.post('/api/gold10/initialize', async (c) => {
  // 既存データを確認
  const existingCount = await c.env.DB.prepare(`
    SELECT COUNT(*) as count FROM gold10_candles
  `).first()

  if (existingCount && existingCount.count > 0) {
    return c.json({ error: '既にデータが存在します', count: existingCount.count }, 400)
  }

  // 過去12時間分（720本）のローソク足を生成
  const initialCandles = generateInitialCandles(720)

  // バッチでDBに挿入
  for (const candle of initialCandles) {
    await c.env.DB.prepare(`
      INSERT INTO gold10_candles (timestamp, open, high, low, close)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      candle.timestamp,
      candle.open,
      candle.high,
      candle.low,
      candle.close
    ).run()
  }

  // 全ローソク足にRSIを計算
  const allCandles = await c.env.DB.prepare(`
    SELECT * FROM gold10_candles ORDER BY timestamp ASC
  `).all()

  const candlesArray = allCandles.results as Candle[]
  
  for (let i = 14; i < candlesArray.length; i++) {
    const candlesForRSI = candlesArray.slice(i - 14, i + 1)
    const rsi = calculateRSI(candlesForRSI, 14)
    
    await c.env.DB.prepare(`
      UPDATE gold10_candles SET rsi = ? WHERE id = ?
    `).bind(rsi, candlesArray[i].id).run()
    
    // RSI更新後、candlesArrayにも反映
    candlesArray[i].rsi = rsi
  }

  // 初期サインを生成
  const initialSignals = generateInitialSignals(candlesArray)
  
  // サインをDBに保存
  for (const signal of initialSignals) {
    await c.env.DB.prepare(`
      INSERT INTO gold10_signals (candle_id, timestamp, type, price, target_price, success, rsi)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      signal.candle_id,
      signal.timestamp,
      signal.type,
      signal.price,
      signal.target_price,
      signal.success,
      signal.rsi
    ).run()
  }

  return c.json({ 
    success: true, 
    message: '初期データを生成しました',
    candleCount: initialCandles.length,
    signalCount: initialSignals.length
  })
})

// ========== ユーザーAPI ==========

// ユーザー名更新
app.put('/api/user/username', async (c) => {
  const userId = getCookie(c, 'user_id')
  if (!userId) {
    return c.json({ error: '未認証' }, 401)
  }

  const { username } = await c.req.json()
  
  if (!username || username.length < 2 || username.length > 20) {
    return c.json({ error: 'ユーザー名は2～20文字で入力してください' }, 400)
  }

  await c.env.DB.prepare(`
    UPDATE users SET username = ? WHERE id = ?
  `).bind(username, userId).run()

  return c.json({ success: true })
})

// ========== ランキングAPI ==========

// 利益総額ランキング
app.get('/api/ranking/profit', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT username, total_profit, total_trades
    FROM users
    WHERE is_admin = 0
    ORDER BY total_profit DESC
    LIMIT 100
  `).all()

  return c.json(results)
})

// 取引数ランキング
app.get('/api/ranking/trades', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT username, total_trades, total_profit
    FROM users
    WHERE is_admin = 0
    ORDER BY total_trades DESC
    LIMIT 100
  `).all()

  return c.json(results)
})

// ========== 動画教材API ==========

app.get('/api/videos', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT * FROM videos ORDER BY order_index ASC, created_at DESC
  `).all()

  return c.json(results)
})

// ========== 管理者API ==========

// ユーザー一覧取得
app.get('/api/admin/users', async (c) => {
  const adminId = getCookie(c, 'admin_id')
  if (!adminId) {
    return c.json({ error: '管理者権限が必要です' }, 403)
  }

  const { results } = await c.env.DB.prepare(`
    SELECT id, username, password, balance, total_profit, total_trades, points, created_at
    FROM users
    ORDER BY created_at DESC
  `).all()

  return c.json(results)
})

// ユーザー追加
app.post('/api/admin/users', async (c) => {
  const adminId = getCookie(c, 'admin_id')
  if (!adminId) {
    return c.json({ error: '管理者権限が必要です' }, 403)
  }

  const { password, username } = await c.req.json()

  // パスワード検証：7文字、数字6文字+英字1文字
  if (!password || password.length !== 7) {
    return c.json({ error: 'パスワードは7文字（数字6桁+英字1文字）である必要があります' }, 400)
  }
  
  const digitCount = (password.match(/\d/g) || []).length
  const letterCount = (password.match(/[a-zA-Z]/g) || []).length
  
  if (digitCount !== 6 || letterCount !== 1) {
    return c.json({ error: 'パスワードは数字6桁と英字1文字を含む必要があります' }, 400)
  }

  const finalUsername = username || generateRandomUsername()

  const result = await c.env.DB.prepare(`
    INSERT INTO users (password, username) VALUES (?, ?)
  `).bind(password, finalUsername).run()

  return c.json({
    success: true,
    userId: result.meta.last_row_id,
    username: finalUsername,
    password
  })
})

// 動画追加
app.post('/api/admin/videos', async (c) => {
  const adminId = getCookie(c, 'admin_id')
  if (!adminId) {
    return c.json({ error: '管理者権限が必要です' }, 403)
  }

  const { title, youtubeUrl, orderIndex } = await c.req.json()

  const result = await c.env.DB.prepare(`
    INSERT INTO videos (title, youtube_url, order_index) VALUES (?, ?, ?)
  `).bind(title, youtubeUrl, orderIndex || 0).run()

  return c.json({
    success: true,
    videoId: result.meta.last_row_id
  })
})

// 動画削除
app.delete('/api/admin/videos/:id', async (c) => {
  const adminId = getCookie(c, 'admin_id')
  if (!adminId) {
    return c.json({ error: '管理者権限が必要です' }, 403)
  }

  const videoId = c.req.param('id')
  await c.env.DB.prepare(`DELETE FROM videos WHERE id = ?`).bind(videoId).run()

  return c.json({ success: true })
})

// ========== チャットAPI ==========

// メッセージ取得
app.get('/api/chat/messages', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT * FROM chat_messages
    ORDER BY created_at DESC
    LIMIT 50
  `).all()

  return c.json(results.reverse())
})

// メッセージ送信
app.post('/api/chat/messages', async (c) => {
  const userId = getCookie(c, 'user_id')
  if (!userId) {
    return c.json({ error: '未認証' }, 401)
  }

  const { message } = await c.req.json()

  const user = await c.env.DB.prepare(`
    SELECT username FROM users WHERE id = ?
  `).bind(userId).first()

  const result = await c.env.DB.prepare(`
    INSERT INTO chat_messages (user_id, username, message)
    VALUES (?, ?, ?)
  `).bind(userId, user?.username, message).run()

  return c.json({
    success: true,
    messageId: result.meta.last_row_id
  })
})

// ========== HTML レンダリング ==========

// ログインページ
app.get('/', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>FXデモトレーディングプラットフォーム - ログイン</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
</head>
<body class="bg-gradient-to-br from-gray-900 to-gray-800 min-h-screen flex items-center justify-center p-4">
    <div class="max-w-md w-full bg-white rounded-2xl shadow-2xl p-8">
        <div class="text-center mb-8">
            <i class="fas fa-chart-line text-6xl text-yellow-500 mb-4"></i>
            <h1 class="text-3xl font-bold text-gray-800">GOLD取引プラットフォーム</h1>
            <p class="text-gray-600 mt-2">デモ取引システム</p>
        </div>

        <form id="loginForm" class="space-y-6">
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                    <i class="fas fa-lock mr-2"></i>パスワード（数字6桁+英字1文字）
                </label>
                <input 
                    type="text" 
                    id="password" 
                    maxlength="7"
                    class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-transparent text-center text-2xl tracking-widest"
                    placeholder="123456a"
                    required
                />
                <p class="text-xs text-gray-500 mt-2">例: 123456a, a234567, 12a3456</p>
            </div>

            <button 
                type="submit"
                class="w-full bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-3 rounded-lg transition duration-200 flex items-center justify-center"
            >
                <i class="fas fa-sign-in-alt mr-2"></i>
                ログイン
            </button>
        </form>

        <div class="mt-8 text-center">
            <a href="/admin-login" class="text-sm text-gray-500 hover:text-gray-700 transition">
                管理者ログイン
            </a>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
    <script>
        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const password = document.getElementById('password').value;

            try {
                const response = await axios.post('/api/auth/login', { password });
                if (response.data.success) {
                    window.location.href = '/trade';
                }
            } catch (error) {
                alert(error.response?.data?.error || 'ログインに失敗しました');
            }
        });

        // 数字と英字のみ入力許可
        document.getElementById('password').addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/[^0-9a-zA-Z]/g, '');
        });
    </script>
</body>
</html>
  `)
})

// 管理者ログインページ
app.get('/admin-login', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>管理者ログイン</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
</head>
<body class="bg-gradient-to-br from-gray-900 to-gray-800 min-h-screen flex items-center justify-center p-4">
    <div class="max-w-md w-full bg-white rounded-2xl shadow-2xl p-8">
        <div class="text-center mb-8">
            <i class="fas fa-user-shield text-6xl text-red-500 mb-4"></i>
            <h1 class="text-3xl font-bold text-gray-800">管理者ログイン</h1>
        </div>

        <form id="adminLoginForm" class="space-y-6">
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                    <i class="fas fa-envelope mr-2"></i>メールアドレス
                </label>
                <input 
                    type="email" 
                    id="email" 
                    class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                    required
                />
            </div>

            <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                    <i class="fas fa-lock mr-2"></i>パスワード
                </label>
                <input 
                    type="password" 
                    id="adminPassword" 
                    class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                    required
                />
            </div>

            <button 
                type="submit"
                class="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-3 rounded-lg transition duration-200"
            >
                ログイン
            </button>

            <a href="/" class="block text-center text-gray-600 hover:text-gray-800 text-sm">
                ← ユーザーログインに戻る
            </a>
        </form>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
    <script>
        document.getElementById('adminLoginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value;
            const password = document.getElementById('adminPassword').value;

            try {
                const response = await axios.post('/api/auth/admin-login', { email, password });
                if (response.data.success) {
                    window.location.href = '/admin';
                }
            } catch (error) {
                alert(error.response?.data?.error || 'ログインに失敗しました');
            }
        });
    </script>
</body>
</html>
  `)
})

// トレード画面
app.get('/trade', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GOLD10取引</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    <!-- Lightweight Charts CDN -->
    <script src="https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js"></script>
    <style>
        @keyframes slideIn {
            from { transform: translateY(-100%); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
        @keyframes slideOut {
            from { transform: translateY(0); opacity: 1; }
            to { transform: translateY(-100%); opacity: 0; }
        }
        .notification-enter { animation: slideIn 0.3s ease-out; }
        .notification-exit { animation: slideOut 0.3s ease-out; }
        
        /* チャート用スタイル */
        #chartContainer {
            position: relative;
            width: 100%;
            height: 600px;
        }
        #rsiContainer {
            position: relative;
            width: 100%;
            height: 150px;
            margin-top: 10px;
        }
    </style>
</head>
<body class="bg-gray-100 overflow-hidden">
    <!-- ヘッダー -->
    <header class="bg-gradient-to-r from-yellow-600 to-yellow-500 text-white p-4 shadow-lg">
        <div class="container mx-auto flex justify-between items-center">
            <h1 class="text-xl font-bold"><i class="fas fa-coins mr-2"></i>GOLD10取引</h1>
            <nav class="flex space-x-4">
                <a href="/trade" class="hover:text-yellow-200"><i class="fas fa-chart-line mr-1"></i>トレード</a>
                <a href="/mypage" class="hover:text-yellow-200"><i class="fas fa-user mr-1"></i>マイページ</a>
                <a href="/ranking" class="hover:text-yellow-200"><i class="fas fa-trophy mr-1"></i>ランキング</a>
                <a href="/videos" class="hover:text-yellow-200"><i class="fas fa-video mr-1"></i>動画教材</a>
                <a href="/chat" class="hover:text-yellow-200"><i class="fas fa-comments mr-1"></i>チャット</a>
                <button onclick="logout()" class="hover:text-yellow-200"><i class="fas fa-sign-out-alt mr-1"></i>ログアウト</button>
            </nav>
        </div>
    </header>

    <!-- 通知ポップアップ -->
    <div id="notification" class="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 hidden">
        <div class="bg-white rounded-lg shadow-2xl p-6 min-w-[300px] border-4">
            <div class="flex items-center justify-center">
                <i id="notificationIcon" class="fas fa-check-circle text-5xl mr-4"></i>
                <div>
                    <h3 id="notificationTitle" class="text-2xl font-bold mb-1"></h3>
                    <p id="notificationMessage" class="text-gray-600"></p>
                </div>
            </div>
        </div>
    </div>

    <!-- メインコンテンツ: 2カラムレイアウト -->
    <div class="flex h-[calc(100vh-72px)]">
        <!-- 左側: GOLD10チャート -->
        <div class="w-2/3 bg-white p-4 overflow-y-auto border-r border-gray-300">
            <div class="mb-4">
                <h2 class="text-2xl font-bold text-gray-800 mb-2">
                    <i class="fas fa-chart-candlestick mr-2 text-yellow-600"></i>
                    GOLD10 練習チャート
                </h2>
                <p class="text-sm text-gray-600">
                    <i class="fas fa-info-circle mr-1"></i>
                    過去12時間分の1分足ローソク足チャート（全ユーザー共通）
                </p>
            </div>
            
            <!-- 現在価格表示 -->
            <div class="bg-gradient-to-br from-yellow-100 to-yellow-50 rounded-lg shadow-md p-4 mb-4">
                <div class="flex justify-between items-center">
                    <div>
                        <h3 class="text-sm text-gray-600 mb-1">GOLD10 現在価格</h3>
                        <div id="gold10Price" class="text-4xl font-bold text-yellow-700">$0.00</div>
                    </div>
                    <div class="text-right">
                        <div class="text-sm text-gray-600">RSI (14)</div>
                        <div id="gold10RSI" class="text-2xl font-bold text-blue-600">--</div>
                    </div>
                </div>
            </div>
            
            <!-- ローソク足チャート -->
            <div class="bg-white rounded-lg shadow-md p-4 mb-4">
                <h3 class="text-lg font-bold mb-2 text-gray-700">
                    <i class="fas fa-chart-line mr-2"></i>価格チャート
                </h3>
                <div id="chartContainer"></div>
            </div>
        </div>

        <!-- 右側: 取引UI -->
        <div class="w-1/3 bg-gray-50 p-4 overflow-y-auto">
            <!-- 残高表示 -->
            <div class="bg-white rounded-lg shadow-md p-4 mb-4">
                <div class="flex justify-between items-center mb-2">
                    <span class="text-gray-600 text-sm">残高</span>
                    <span class="text-gray-600 text-sm">総損益</span>
                </div>
                <div class="flex justify-between items-center">
                    <span id="balance" class="text-2xl font-bold text-gray-800">¥0</span>
                    <span id="totalProfit" class="text-xl font-bold">¥0</span>
                </div>
                <div class="text-center mt-2">
                    <button onclick="toggleReset()" class="text-sm text-gray-500 hover:text-gray-700">
                        残高リセット
                    </button>
                </div>
            </div>

            <!-- 購入金額 -->
            <div class="bg-white rounded-lg shadow-md p-4 mb-4">
                <label class="block text-gray-700 font-medium mb-3">購入ロット数</label>
                
                <div class="flex items-center justify-between mb-4">
                    <button onclick="decreaseAmount()" class="w-12 h-12 bg-gray-200 hover:bg-gray-300 rounded-lg text-xl font-bold">
                        −
                    </button>
                    <input 
                        type="number" 
                        id="amount" 
                        value="1" 
                        step="1" 
                        min="1"
                        max="3"
                        class="flex-1 mx-4 text-center text-2xl font-bold border-2 border-gray-300 rounded-lg p-2"
                    />
                    <button onclick="increaseAmount()" class="w-12 h-12 bg-gray-200 hover:bg-gray-300 rounded-lg text-xl font-bold">
                        +
                    </button>
                </div>

                <div class="grid grid-cols-3 gap-2">
                    <button onclick="setAmount(1)" class="py-2 bg-blue-100 hover:bg-blue-200 rounded-lg border-2 border-blue-400 font-bold">1 lot</button>
                    <button onclick="setAmount(2)" class="py-2 bg-gray-100 hover:bg-gray-200 rounded-lg border border-gray-300">2 lot</button>
                    <button onclick="setAmount(3)" class="py-2 bg-gray-100 hover:bg-gray-200 rounded-lg border border-gray-300">3 lot</button>
                </div>
            </div>

            <!-- 売買ボタン -->
            <div class="grid grid-cols-2 gap-3 mb-4">
                <button onclick="openPosition('BUY')" class="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-bold py-4 rounded-lg shadow-lg">
                    <i class="fas fa-arrow-up mr-2"></i>買う
                </button>
                <button onclick="openPosition('SELL')" class="bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white font-bold py-4 rounded-lg shadow-lg">
                    <i class="fas fa-arrow-down mr-2"></i>売る
                </button>
            </div>

            <!-- オープンポジション表示 -->
            <div class="bg-white rounded-lg shadow-md p-4 mb-4">
                <h3 class="text-lg font-bold mb-3 text-gray-700">
                    <i class="fas fa-list mr-2"></i>保有ポジション
                </h3>
                <div id="openPositions" class="space-y-3"></div>
            </div>

            <!-- AIアドバイス -->
            <div class="bg-blue-50 border-l-4 border-blue-500 p-4 mb-4 rounded">
                <div class="flex items-start">
                    <i class="fas fa-lightbulb text-blue-500 text-xl mr-3 mt-1"></i>
                    <div>
                        <h3 class="font-bold text-blue-800 mb-1">取引のヒント</h3>
                        <p class="text-sm text-blue-700">
                            サインが出たら3本後のローソク足で反転の可能性あり！<br>
                            RSI 35-65の範囲でサインの勝率UP！
                        </p>
                    </div>
                </div>
            </div>

            <!-- オンラインチャット -->
            <div class="bg-white rounded-lg shadow-md">
                <button onclick="toggleChat()" class="w-full flex items-center justify-between p-4 text-gray-700 hover:text-gray-900">
                    <div class="flex items-center">
                        <i class="fas fa-comments mr-2"></i>
                        <span>オンラインチャット</span>
                    </div>
                    <i id="chatToggleIcon" class="fas fa-chevron-down"></i>
                </button>
                
                <!-- チャットエリア -->
                <div id="chatArea" class="hidden border-t border-gray-200">
                    <div id="chatMessages" class="h-64 overflow-y-auto p-4 space-y-2 bg-gray-50">
                        <p class="text-center text-gray-500 text-sm">読み込み中...</p>
                    </div>
                    <div class="p-4 bg-white border-t border-gray-200">
                        <form id="chatForm" class="flex space-x-2">
                            <input 
                                type="text" 
                                id="chatInput" 
                                class="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500 text-sm"
                                placeholder="メッセージを入力..."
                                required
                            />
                            <button 
                                type="submit"
                                class="bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-2 rounded-lg font-bold text-sm"
                            >
                                <i class="fas fa-paper-plane"></i>
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
    <script>
        // ========== GOLD10チャート関連 ==========
        let chart = null;
        let candlestickSeries = null;
        let signalMarkers = [];
        
        // Lightweight Chartsの初期化
        function initializeCharts() {
            // メインチャート（ローソク足）
            chart = LightweightCharts.createChart(document.getElementById('chartContainer'), {
                width: document.getElementById('chartContainer').clientWidth,
                height: 600,
                layout: {
                    background: { color: '#ffffff' },
                    textColor: '#333',
                },
                grid: {
                    vertLines: { color: '#f0f0f0' },
                    horzLines: { color: '#f0f0f0' },
                },
                crosshair: {
                    mode: LightweightCharts.CrosshairMode.Normal,
                },
                timeScale: {
                    timeVisible: true,
                    secondsVisible: false,
                },
            });

            candlestickSeries = chart.addCandlestickSeries({
                upColor: '#26a69a',
                downColor: '#ef5350',
                borderVisible: false,
                wickUpColor: '#26a69a',
                wickDownColor: '#ef5350',
            });

            // ウィンドウリサイズ対応
            window.addEventListener('resize', () => {
                chart.applyOptions({ 
                    width: document.getElementById('chartContainer').clientWidth 
                });
            });
        }

        // GOLD10データを読み込んでチャートに表示
        async function loadGold10Chart() {
            try {
                // 過去12時間分のローソク足データを取得
                const candlesResponse = await axios.get('/api/gold10/candles?hours=12');
                const candles = candlesResponse.data;

                // サインデータを取得
                const signalsResponse = await axios.get('/api/gold10/signals?hours=12');
                const signals = signalsResponse.data;

                // ローソク足データをLightweight Charts形式に変換
                const candleData = candles.map(c => ({
                    time: c.timestamp,
                    open: c.open,
                    high: c.high,
                    low: c.low,
                    close: c.close
                }));

                // チャートにデータをセット
                if (candleData.length > 0) {
                    candlestickSeries.setData(candleData);
                    
                    // 最新価格とRSIを表示
                    const latestCandle = candles[candles.length - 1];
                    if (latestCandle) {
                        document.getElementById('gold10Price').textContent = 
                            '$' + latestCandle.close.toFixed(2);
                        document.getElementById('gold10RSI').textContent = 
                            latestCandle.rsi ? latestCandle.rsi.toFixed(1) : '--';
                        
                        // RSI色分け
                        const rsiEl = document.getElementById('gold10RSI');
                        if (latestCandle.rsi >= 70) {
                            rsiEl.className = 'text-2xl font-bold text-red-600';
                        } else if (latestCandle.rsi <= 30) {
                            rsiEl.className = 'text-2xl font-bold text-green-600';
                        } else {
                            rsiEl.className = 'text-2xl font-bold text-blue-600';
                        }
                    }
                }

                // サインをマーカーとして表示
                if (signals.length > 0) {
                    const markers = signals.map(signal => ({
                        time: signal.timestamp,
                        position: signal.type === 'BUY' ? 'belowBar' : 'aboveBar',
                        color: signal.type === 'BUY' ? '#26a69a' : '#ef5350',
                        shape: signal.type === 'BUY' ? 'arrowUp' : 'arrowDown',
                        text: signal.type === 'BUY' ? '買サイン' : '売サイン',
                    }));
                    candlestickSeries.setMarkers(markers);
                    signalMarkers = markers;
                }

            } catch (error) {
                console.error('チャートデータ取得エラー:', error);
            }
        }

        // チャートをリアルタイム更新
        async function updateGold10Chart() {
            try {
                const response = await axios.get('/api/gold10/latest');
                const { candle, signals } = response.data;

                if (candle) {
                    // 最新ローソク足を更新
                    candlestickSeries.update({
                        time: candle.timestamp,
                        open: candle.open,
                        high: candle.high,
                        low: candle.low,
                        close: candle.close
                    });

                    // 現在価格とRSI表示を更新
                    document.getElementById('gold10Price').textContent = 
                        '$' + candle.close.toFixed(2);
                    document.getElementById('gold10RSI').textContent = 
                        candle.rsi ? candle.rsi.toFixed(1) : '--';
                    
                    // RSI色分け
                    const rsiEl = document.getElementById('gold10RSI');
                    if (candle.rsi >= 70) {
                        rsiEl.className = 'text-2xl font-bold text-red-600';
                    } else if (candle.rsi <= 30) {
                        rsiEl.className = 'text-2xl font-bold text-green-600';
                    } else {
                        rsiEl.className = 'text-2xl font-bold text-blue-600';
                    }
                    
                    // currentPriceもGOLD10価格に更新
                    currentPrice = candle.close;
                }

                // 新しいサインがあればマーカーを追加
                if (signals && signals.length > 0) {
                    const newMarkers = signals.slice(0, 10).map(signal => ({
                        time: signal.timestamp,
                        position: signal.type === 'BUY' ? 'belowBar' : 'aboveBar',
                        color: signal.type === 'BUY' ? '#26a69a' : '#ef5350',
                        shape: signal.type === 'BUY' ? 'arrowUp' : 'arrowDown',
                        text: signal.type === 'BUY' ? '買サイン' : '売サイン',
                    }));
                    candlestickSeries.setMarkers(newMarkers);
                }

            } catch (error) {
                console.error('チャート更新エラー:', error);
            }
        }

        // ========== 既存のトレード機能 ==========
        let currentPrice = 0;
        let openPositions = [];
        let currentUserId = null;
        let chatOpen = false;

        // 通知表示
        function showNotification(type, title, message) {
            const notification = document.getElementById('notification');
            const icon = document.getElementById('notificationIcon');
            const titleEl = document.getElementById('notificationTitle');
            const messageEl = document.getElementById('notificationMessage');
            const container = notification.querySelector('div');

            // タイプに応じてスタイル変更
            if (type === 'entry') {
                container.className = 'bg-white rounded-lg shadow-2xl p-6 min-w-[300px] border-4 border-green-500';
                icon.className = 'fas fa-chart-line text-5xl mr-4 text-green-500';
            } else if (type === 'profit') {
                container.className = 'bg-white rounded-lg shadow-2xl p-6 min-w-[300px] border-4 border-blue-500';
                icon.className = 'fas fa-check-circle text-5xl mr-4 text-blue-500';
            } else if (type === 'loss') {
                container.className = 'bg-white rounded-lg shadow-2xl p-6 min-w-[300px] border-4 border-red-500';
                icon.className = 'fas fa-times-circle text-5xl mr-4 text-red-500';
            }

            titleEl.textContent = title;
            messageEl.textContent = message;

            notification.classList.remove('hidden');
            notification.classList.add('notification-enter');

            setTimeout(() => {
                notification.classList.remove('notification-enter');
                notification.classList.add('notification-exit');
                setTimeout(() => {
                    notification.classList.add('hidden');
                    notification.classList.remove('notification-exit');
                }, 300);
            }, 2500);
        }

        async function loadUserData() {
            try {
                const response = await axios.get('/api/auth/me');
                const user = response.data;
                currentUserId = user.id;
                document.getElementById('balance').textContent = '¥' + user.balance.toLocaleString('ja-JP', {minimumFractionDigits: 2});
                const profitElement = document.getElementById('totalProfit');
                profitElement.textContent = '¥' + Math.round(user.total_profit).toLocaleString('ja-JP');
                profitElement.className = user.total_profit >= 0 ? 'text-xl font-bold text-green-600' : 'text-xl font-bold text-red-600';
            } catch (error) {
                window.location.href = '/';
            }
        }

        async function updateGoldPrice() {
            try {
                // GOLD10の最新価格を取得
                const response = await axios.get('/api/gold10/latest');
                const candle = response.data.candle;
                currentPrice = parseFloat(candle.close);
                // GOLD10価格とRSIを更新
                document.getElementById('gold10Price').textContent = '$' + currentPrice.toFixed(2);
                if (candle.rsi) {
                    document.getElementById('gold10RSI').textContent = candle.rsi.toFixed(1);
                }
            } catch (error) {
                console.error('価格取得エラー:', error);
            }
        }

        async function loadOpenPositions() {
            try {
                const response = await axios.get('/api/trade/open-positions');
                openPositions = response.data;
                displayOpenPositions();
            } catch (error) {
                console.error('ポジション取得エラー:', error);
            }
        }

        function displayOpenPositions() {
            const container = document.getElementById('openPositions');
            
            if (openPositions.length === 0) {
                container.innerHTML = '';
                return;
            }

            container.innerHTML = openPositions.map(pos => {
                const pl = pos.type === 'BUY' 
                    ? (currentPrice - pos.entry_price) * pos.amount * 152.96
                    : (pos.entry_price - currentPrice) * pos.amount * 152.96;
                const plColor = pl >= 0 ? 'text-green-600' : 'text-red-600';
                const typeColor = pos.type === 'BUY' ? 'bg-green-100 text-green-800 border-green-300' : 'bg-red-100 text-red-800 border-red-300';
                
                return \`
                    <div class="bg-white border-2 \${typeColor.split(' ')[2]} rounded-lg p-4 shadow-md">
                        <div class="flex justify-between items-start mb-3">
                            <div class="flex-1">
                                <span class="px-3 py-1 rounded-full text-sm font-bold \${typeColor}">
                                    \${pos.type === 'BUY' ? '買い' : '売り'}
                                </span>
                                <span class="ml-2 text-gray-600 font-medium">\${pos.amount} lot</span>
                            </div>
                            <button 
                                onclick="closePosition(\${pos.id})"
                                class="bg-gray-800 hover:bg-gray-900 text-white rounded-full w-8 h-8 flex items-center justify-center font-bold transition"
                                title="決済"
                            >
                                ✕
                            </button>
                        </div>
                        <div class="space-y-2">
                            <div class="flex justify-between text-sm text-gray-600">
                                <span>エントリー価格:</span>
                                <span class="font-mono">$\${pos.entry_price.toFixed(2)}</span>
                            </div>
                            <div class="flex justify-between text-sm text-gray-600">
                                <span>現在価格:</span>
                                <span class="font-mono">$\${currentPrice.toFixed(2)}</span>
                            </div>
                            <div class="flex justify-between items-center pt-2 border-t border-gray-200">
                                <span class="font-bold text-gray-700">損益:</span>
                                <span class="\${plColor} font-bold text-xl">¥\${Math.round(pl).toLocaleString('ja-JP')}</span>
                            </div>
                        </div>
                    </div>
                \`;
            }).join('');
        }

        async function openPosition(type) {
            const amount = parseFloat(document.getElementById('amount').value);
            if (amount <= 0) {
                alert('金額を入力してください');
                return;
            }

            try {
                const response = await axios.post('/api/trade/open', { type, amount });
                await loadOpenPositions();
                await loadUserData();
                
                const typeName = type === 'BUY' ? '買い' : '売り';
                showNotification('entry', 'エントリーしました！', \`\${typeName}ポジション \${amount} lot を開きました\`);
            } catch (error) {
                alert('エラー: ' + (error.response?.data?.error || '取引に失敗しました'));
            }
        }

        async function closePosition(tradeId) {
            try {
                const response = await axios.post(\`/api/trade/close/\${tradeId}\`);
                const profitLoss = response.data.profitLoss;
                
                await loadOpenPositions();
                await loadUserData();
                
                if (profitLoss >= 0) {
                    showNotification('profit', '利確しました！', \`+¥\${profitLoss.toLocaleString('ja-JP', {minimumFractionDigits: 2})}\`);
                } else {
                    showNotification('loss', '損切りしました', \`¥\${profitLoss.toLocaleString('ja-JP', {minimumFractionDigits: 2})}\`);
                }
            } catch (error) {
                alert('決済に失敗しました');
            }
        }

        function setAmount(value) {
            document.getElementById('amount').value = value;
        }

        function increaseAmount() {
            const input = document.getElementById('amount');
            const current = parseFloat(input.value);
            if (current < 1) {
                input.value = 1;
            } else if (current < 2) {
                input.value = 2;
            } else if (current < 3) {
                input.value = 3;
            } else {
                input.value = 1; // 3の次は1に戻る
            }
        }

        function decreaseAmount() {
            const input = document.getElementById('amount');
            const current = parseFloat(input.value);
            if (current > 3) {
                input.value = 3;
            } else if (current > 2) {
                input.value = 2;
            } else if (current > 1) {
                input.value = 1;
            } else {
                input.value = 3; // 1の前は3に戻る
            }
        }

        function toggleReset() {
            if (confirm('残高を初期値（¥1,000,000）にリセットしますか？\\nこの操作は取り消せません。')) {
                alert('この機能は現在実装中です');
            }
        }

        // チャット機能
        function toggleChat() {
            chatOpen = !chatOpen;
            const chatArea = document.getElementById('chatArea');
            const icon = document.getElementById('chatToggleIcon');
            
            if (chatOpen) {
                chatArea.classList.remove('hidden');
                icon.className = 'fas fa-chevron-up';
                loadChatMessages();
            } else {
                chatArea.classList.add('hidden');
                icon.className = 'fas fa-chevron-down';
            }
        }

        async function loadChatMessages() {
            try {
                const response = await axios.get('/api/chat/messages');
                const messages = response.data;
                const container = document.getElementById('chatMessages');
                
                if (messages.length === 0) {
                    container.innerHTML = '<p class="text-center text-gray-500 text-sm">メッセージがありません</p>';
                    return;
                }

                container.innerHTML = messages.map(msg => {
                    const isMyMessage = msg.user_id === currentUserId;
                    const time = new Date(msg.created_at).toLocaleString('ja-JP', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                    
                    return \`
                        <div class="\${isMyMessage ? 'flex justify-end' : 'flex justify-start'}">
                            <div class="\${isMyMessage ? 'bg-yellow-100 border-yellow-300' : 'bg-gray-100 border-gray-300'} max-w-[80%] px-3 py-2 rounded-lg border text-sm">
                                <div class="text-xs text-gray-600 mb-1">\${msg.username} · \${time}</div>
                                <div class="text-gray-800">\${msg.message}</div>
                            </div>
                        </div>
                    \`;
                }).join('');

                container.scrollTop = container.scrollHeight;
            } catch (error) {
                console.error('メッセージ取得エラー:', error);
            }
        }

        document.getElementById('chatForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = document.getElementById('chatInput');
            const message = input.value.trim();

            if (!message) return;

            try {
                await axios.post('/api/chat/messages', { message });
                input.value = '';
                await loadChatMessages();
            } catch (error) {
                alert('メッセージ送信に失敗しました');
            }
        });

        async function logout() {
            await axios.post('/api/auth/logout');
            window.location.href = '/';
        }

        // 初期化
        (async () => {
            await loadUserData();
            // GOLD10チャートを初期化
            initializeCharts();
            await loadGold10Chart();
            await loadOpenPositions();
        })();
        
        // GOLD10チャートを30秒ごとに更新（新しいローソク足とサイン生成）
        setInterval(async () => {
            // サーバー側で新しいローソク足を生成
            await axios.post('/api/gold10/generate').catch(err => {
                console.log('ローソク足生成:', err.response?.status === 500 ? 'スキップ' : err.message);
            });
            
            // チャートを更新
            await updateGold10Chart();
        }, 30000);  // 30秒ごと

        // GOLD10価格と損益を10秒ごとに更新
        setInterval(async () => {
            // 最新のGOLD10価格を取得して表示を更新
            await updateGoldPrice();
            
            // チャートも更新
            await updateGold10Chart();
            
            // 保有ポジションの損益も更新
            if (openPositions.length > 0) {
                displayOpenPositions();
            }
        }, 10000);  // 10秒ごと

        // チャットが開いている場合は5秒ごとに更新
        setInterval(() => {
            if (chatOpen) {
                loadChatMessages();
            }
        }, 5000);
    </script>
</body>
</html>
  `)
})

// マイページ
app.get('/mypage', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>マイページ</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
</head>
<body class="bg-gray-100">
    <header class="bg-gradient-to-r from-yellow-600 to-yellow-500 text-white p-4 shadow-lg">
        <div class="container mx-auto flex justify-between items-center">
            <h1 class="text-xl font-bold"><i class="fas fa-user mr-2"></i>マイページ</h1>
            <nav class="flex space-x-4">
                <a href="/trade" class="hover:text-yellow-200"><i class="fas fa-chart-line mr-1"></i>トレード</a>
                <a href="/mypage" class="hover:text-yellow-200"><i class="fas fa-user mr-1"></i>マイページ</a>
                <a href="/ranking" class="hover:text-yellow-200"><i class="fas fa-trophy mr-1"></i>ランキング</a>
                <a href="/videos" class="hover:text-yellow-200"><i class="fas fa-video mr-1"></i>動画教材</a>
                <a href="/chat" class="hover:text-yellow-200"><i class="fas fa-comments mr-1"></i>チャット</a>
                <button onclick="logout()" class="hover:text-yellow-200"><i class="fas fa-sign-out-alt mr-1"></i>ログアウト</button>
            </nav>
        </div>
    </header>

    <div class="container mx-auto p-4 max-w-4xl">
        <!-- ユーザー情報 -->
        <div class="bg-white rounded-lg shadow-md p-6 mb-4">
            <h2 class="text-2xl font-bold mb-4"><i class="fas fa-id-card mr-2 text-yellow-500"></i>ユーザー情報</h2>
            <div class="space-y-4">
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">アカウント名</label>
                    <div class="flex space-x-2">
                        <input 
                            type="text" 
                            id="username" 
                            class="flex-1 px-4 py-2 border border-gray-300 rounded-lg"
                            placeholder="ユーザー名"
                        />
                        <button onclick="updateUsername()" class="bg-yellow-500 hover:bg-yellow-600 text-white px-6 py-2 rounded-lg">
                            変更
                        </button>
                    </div>
                </div>
                <div class="grid grid-cols-3 gap-4 mt-6">
                    <div class="bg-gradient-to-br from-blue-50 to-blue-100 p-4 rounded-lg">
                        <div class="text-sm text-gray-600 mb-1">残高</div>
                        <div id="balance" class="text-2xl font-bold text-blue-700">¥0</div>
                    </div>
                    <div class="bg-gradient-to-br from-green-50 to-green-100 p-4 rounded-lg">
                        <div class="text-sm text-gray-600 mb-1">総利益</div>
                        <div id="totalProfit" class="text-2xl font-bold text-green-700">¥0</div>
                    </div>
                    <div class="bg-gradient-to-br from-purple-50 to-purple-100 p-4 rounded-lg">
                        <div class="text-sm text-gray-600 mb-1">取引数</div>
                        <div id="totalTrades" class="text-2xl font-bold text-purple-700">0</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- ポイント情報 -->
        <div class="bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-lg shadow-md p-6 mb-4">
            <h2 class="text-2xl font-bold mb-4"><i class="fas fa-star mr-2 text-yellow-500"></i>保有ポイント</h2>
            <div class="text-center">
                <div id="points" class="text-5xl font-bold text-yellow-600 mb-4">0 pt</div>
                <div class="text-sm text-gray-600">
                    連続ログイン: <span id="consecutiveDays" class="font-bold">0</span>日
                </div>
            </div>

            <div class="mt-6 bg-white rounded-lg p-4">
                <h3 class="font-bold text-gray-800 mb-2">ポイント獲得方法</h3>
                <ul class="text-sm text-gray-700 space-y-1">
                    <li><i class="fas fa-check text-green-500 mr-2"></i>デイリーログイン: 毎日初回ログインで10ポイント</li>
                    <li><i class="fas fa-check text-green-500 mr-2"></i>7日連続ログイン: 追加で+50ポイントボーナス！</li>
                    <li><i class="fas fa-check text-green-500 mr-2"></i>トレード完了: 1トレードごとに1ポイント（決済から5分以内の連続取引は対象外）</li>
                    <li><i class="fas fa-check text-green-500 mr-2"></i>週次ランキング: 1位10,000pt / 2位5,000pt / 3位1,000pt</li>
                </ul>
            </div>
        </div>

        <!-- 取引履歴 -->
        <div class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-2xl font-bold mb-4"><i class="fas fa-history mr-2 text-yellow-500"></i>取引履歴</h2>
            <div id="tradeHistory" class="space-y-2 max-h-96 overflow-y-auto">
                <p class="text-center text-gray-500 py-4">読み込み中...</p>
            </div>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
    <script>
        async function loadUserData() {
            try {
                const response = await axios.get('/api/auth/me');
                const user = response.data;
                document.getElementById('username').value = user.username;
                document.getElementById('balance').textContent = '¥' + user.balance.toLocaleString('ja-JP', {minimumFractionDigits: 2});
                document.getElementById('totalProfit').textContent = '¥' + user.total_profit.toLocaleString('ja-JP', {minimumFractionDigits: 2});
                document.getElementById('totalTrades').textContent = user.total_trades.toLocaleString();
                document.getElementById('points').textContent = user.points.toLocaleString() + ' pt';
                document.getElementById('consecutiveDays').textContent = user.consecutive_login_days;
            } catch (error) {
                window.location.href = '/';
            }
        }

        async function loadTradeHistory() {
            try {
                const response = await axios.get('/api/trade/history');
                const trades = response.data;
                const container = document.getElementById('tradeHistory');
                
                if (trades.length === 0) {
                    container.innerHTML = '<p class="text-center text-gray-500 py-4">取引履歴がありません</p>';
                    return;
                }

                container.innerHTML = trades.map(trade => {
                    const pl = trade.profit_loss;
                    const plColor = pl >= 0 ? 'text-green-600' : 'text-red-600';
                    const typeColor = trade.type === 'BUY' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';
                    const date = new Date(trade.exit_time).toLocaleString('ja-JP');
                    
                    return \`
                        <div class="border border-gray-200 rounded-lg p-3">
                            <div class="flex justify-between items-center mb-2">
                                <span class="px-2 py-1 rounded text-sm font-bold \${typeColor}">
                                    \${trade.type === 'BUY' ? '買い' : '売り'} \${trade.amount} lot
                                </span>
                                <span class="\${plColor} font-bold text-lg">¥\${pl.toLocaleString('ja-JP', {minimumFractionDigits: 2})}</span>
                            </div>
                            <div class="text-xs text-gray-600 space-y-1">
                                <div>エントリー: $\${trade.entry_price.toFixed(2)} → 決済: $\${trade.exit_price.toFixed(2)}</div>
                                <div>\${date}</div>
                            </div>
                        </div>
                    \`;
                }).join('');
            } catch (error) {
                console.error('取引履歴取得エラー:', error);
            }
        }

        async function updateUsername() {
            const username = document.getElementById('username').value;
            if (!username || username.length < 2) {
                alert('ユーザー名は2文字以上で入力してください');
                return;
            }

            try {
                await axios.put('/api/user/username', { username });
                alert('ユーザー名を更新しました');
            } catch (error) {
                alert('更新に失敗しました: ' + (error.response?.data?.error || ''));
            }
        }

        async function logout() {
            await axios.post('/api/auth/logout');
            window.location.href = '/';
        }

        loadUserData();
        loadTradeHistory();
    </script>
</body>
</html>
  `)
})

// ランキングページ
app.get('/ranking', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ランキング</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
</head>
<body class="bg-gray-100">
    <header class="bg-gradient-to-r from-yellow-600 to-yellow-500 text-white p-4 shadow-lg">
        <div class="container mx-auto flex justify-between items-center">
            <h1 class="text-xl font-bold"><i class="fas fa-trophy mr-2"></i>ランキング</h1>
            <nav class="flex space-x-4">
                <a href="/trade" class="hover:text-yellow-200"><i class="fas fa-chart-line mr-1"></i>トレード</a>
                <a href="/mypage" class="hover:text-yellow-200"><i class="fas fa-user mr-1"></i>マイページ</a>
                <a href="/ranking" class="hover:text-yellow-200"><i class="fas fa-trophy mr-1"></i>ランキング</a>
                <a href="/videos" class="hover:text-yellow-200"><i class="fas fa-video mr-1"></i>動画教材</a>
                <a href="/chat" class="hover:text-yellow-200"><i class="fas fa-comments mr-1"></i>チャット</a>
                <button onclick="logout()" class="hover:text-yellow-200"><i class="fas fa-sign-out-alt mr-1"></i>ログアウト</button>
            </nav>
        </div>
    </header>

    <div class="container mx-auto p-4 max-w-6xl">
        <!-- タブ -->
        <div class="flex space-x-2 mb-4">
            <button onclick="showTab('profit')" id="profitTab" class="flex-1 bg-yellow-500 text-white font-bold py-3 rounded-lg shadow">
                <i class="fas fa-dollar-sign mr-2"></i>利益総額ランキング
            </button>
            <button onclick="showTab('trades')" id="tradesTab" class="flex-1 bg-white text-gray-700 font-bold py-3 rounded-lg shadow">
                <i class="fas fa-chart-bar mr-2"></i>取引数ランキング
            </button>
        </div>

        <!-- ランキング情報 -->
        <div class="bg-gradient-to-br from-yellow-50 to-orange-50 rounded-lg shadow-md p-6 mb-4">
            <h2 class="text-xl font-bold text-gray-800 mb-2">
                <i class="fas fa-gift mr-2 text-red-500"></i>週次ランキング報酬
            </h2>
            <div class="flex justify-around text-center">
                <div>
                    <div class="text-3xl font-bold text-yellow-500">1位</div>
                    <div class="text-sm text-gray-600">10,000 pt</div>
                </div>
                <div>
                    <div class="text-3xl font-bold text-gray-400">2位</div>
                    <div class="text-sm text-gray-600">5,000 pt</div>
                </div>
                <div>
                    <div class="text-3xl font-bold text-orange-600">3位</div>
                    <div class="text-sm text-gray-600">1,000 pt</div>
                </div>
            </div>
        </div>

        <!-- 利益総額ランキング -->
        <div id="profitRanking" class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-2xl font-bold mb-4">利益総額ランキング</h2>
            <div id="profitList" class="space-y-2">
                <p class="text-center text-gray-500 py-4">読み込み中...</p>
            </div>
        </div>

        <!-- 取引数ランキング -->
        <div id="tradesRanking" class="bg-white rounded-lg shadow-md p-6 hidden">
            <h2 class="text-2xl font-bold mb-4">取引数ランキング</h2>
            <div id="tradesList" class="space-y-2">
                <p class="text-center text-gray-500 py-4">読み込み中...</p>
            </div>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
    <script>
        function showTab(tab) {
            if (tab === 'profit') {
                document.getElementById('profitRanking').classList.remove('hidden');
                document.getElementById('tradesRanking').classList.add('hidden');
                document.getElementById('profitTab').className = 'flex-1 bg-yellow-500 text-white font-bold py-3 rounded-lg shadow';
                document.getElementById('tradesTab').className = 'flex-1 bg-white text-gray-700 font-bold py-3 rounded-lg shadow';
            } else {
                document.getElementById('profitRanking').classList.add('hidden');
                document.getElementById('tradesRanking').classList.remove('hidden');
                document.getElementById('profitTab').className = 'flex-1 bg-white text-gray-700 font-bold py-3 rounded-lg shadow';
                document.getElementById('tradesTab').className = 'flex-1 bg-yellow-500 text-white font-bold py-3 rounded-lg shadow';
            }
        }

        async function loadProfitRanking() {
            try {
                const response = await axios.get('/api/ranking/profit');
                const rankings = response.data;
                const container = document.getElementById('profitList');
                
                if (rankings.length === 0) {
                    container.innerHTML = '<p class="text-center text-gray-500 py-4">データがありません</p>';
                    return;
                }

                container.innerHTML = rankings.map((user, index) => {
                    const rankIcon = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : (index + 1);
                    const profitColor = user.total_profit >= 0 ? 'text-green-600' : 'text-red-600';
                    
                    return \`
                        <div class="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
                            <div class="flex items-center space-x-4">
                                <div class="text-2xl font-bold w-12 text-center">\${rankIcon}</div>
                                <div>
                                    <div class="font-bold text-gray-800">\${user.username}</div>
                                    <div class="text-sm text-gray-500">取引数: \${user.total_trades}</div>
                                </div>
                            </div>
                            <div class="text-right">
                                <div class="\${profitColor} font-bold text-lg">
                                    ¥\${user.total_profit.toLocaleString('ja-JP', {minimumFractionDigits: 2})}
                                </div>
                            </div>
                        </div>
                    \`;
                }).join('');
            } catch (error) {
                console.error('ランキング取得エラー:', error);
            }
        }

        async function loadTradesRanking() {
            try {
                const response = await axios.get('/api/ranking/trades');
                const rankings = response.data;
                const container = document.getElementById('tradesList');
                
                if (rankings.length === 0) {
                    container.innerHTML = '<p class="text-center text-gray-500 py-4">データがありません</p>';
                    return;
                }

                container.innerHTML = rankings.map((user, index) => {
                    const rankIcon = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : (index + 1);
                    const profitColor = user.total_profit >= 0 ? 'text-green-600' : 'text-red-600';
                    
                    return \`
                        <div class="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
                            <div class="flex items-center space-x-4">
                                <div class="text-2xl font-bold w-12 text-center">\${rankIcon}</div>
                                <div>
                                    <div class="font-bold text-gray-800">\${user.username}</div>
                                    <div class="text-sm \${profitColor}">
                                        利益: ¥\${user.total_profit.toLocaleString('ja-JP', {minimumFractionDigits: 2})}
                                    </div>
                                </div>
                            </div>
                            <div class="text-right">
                                <div class="text-gray-800 font-bold text-lg">
                                    <i class="fas fa-chart-bar mr-1"></i>\${user.total_trades.toLocaleString()}
                                </div>
                            </div>
                        </div>
                    \`;
                }).join('');
            } catch (error) {
                console.error('ランキング取得エラー:', error);
            }
        }

        async function logout() {
            await axios.post('/api/auth/logout');
            window.location.href = '/';
        }

        loadProfitRanking();
        loadTradesRanking();
    </script>
</body>
</html>
  `)
})

// 動画教材ページ
app.get('/videos', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>動画教材</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
</head>
<body class="bg-gray-100">
    <header class="bg-gradient-to-r from-yellow-600 to-yellow-500 text-white p-4 shadow-lg">
        <div class="container mx-auto flex justify-between items-center">
            <h1 class="text-xl font-bold"><i class="fas fa-video mr-2"></i>動画教材</h1>
            <nav class="flex space-x-4">
                <a href="/trade" class="hover:text-yellow-200"><i class="fas fa-chart-line mr-1"></i>トレード</a>
                <a href="/mypage" class="hover:text-yellow-200"><i class="fas fa-user mr-1"></i>マイページ</a>
                <a href="/ranking" class="hover:text-yellow-200"><i class="fas fa-trophy mr-1"></i>ランキング</a>
                <a href="/videos" class="hover:text-yellow-200"><i class="fas fa-video mr-1"></i>動画教材</a>
                <a href="/chat" class="hover:text-yellow-200"><i class="fas fa-comments mr-1"></i>チャット</a>
                <button onclick="logout()" class="hover:text-yellow-200"><i class="fas fa-sign-out-alt mr-1"></i>ログアウト</button>
            </nav>
        </div>
    </header>

    <div class="container mx-auto p-4 max-w-4xl">
        <div class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-2xl font-bold mb-6">
                <i class="fas fa-graduation-cap mr-2 text-yellow-500"></i>トレーディング教材
            </h2>
            <div id="videoList" class="space-y-4">
                <p class="text-center text-gray-500 py-4">読み込み中...</p>
            </div>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
    <script>
        function getYoutubeEmbedUrl(url) {
            const videoId = url.split('/').pop().split('?')[0];
            return \`https://www.youtube.com/embed/\${videoId}\`;
        }

        async function loadVideos() {
            try {
                const response = await axios.get('/api/videos');
                const videos = response.data;
                const container = document.getElementById('videoList');
                
                if (videos.length === 0) {
                    container.innerHTML = '<p class="text-center text-gray-500 py-4">動画がありません</p>';
                    return;
                }

                container.innerHTML = videos.map(video => \`
                    <div class="border border-gray-200 rounded-lg overflow-hidden">
                        <div class="aspect-video">
                            <iframe 
                                class="w-full h-full"
                                src="\${getYoutubeEmbedUrl(video.youtube_url)}" 
                                frameborder="0" 
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                                allowfullscreen
                            ></iframe>
                        </div>
                        <div class="p-4">
                            <h3 class="font-bold text-lg text-gray-800">\${video.title}</h3>
                            <a href="\${video.youtube_url}" target="_blank" class="text-sm text-blue-600 hover:text-blue-800 mt-2 inline-block">
                                <i class="fab fa-youtube mr-1"></i>YouTubeで開く
                            </a>
                        </div>
                    </div>
                \`).join('');
            } catch (error) {
                console.error('動画取得エラー:', error);
            }
        }

        async function logout() {
            await axios.post('/api/auth/logout');
            window.location.href = '/';
        }

        loadVideos();
    </script>
</body>
</html>
  `)
})

// チャットページ
app.get('/chat', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>オンラインチャット</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
</head>
<body class="bg-gray-100">
    <header class="bg-gradient-to-r from-yellow-600 to-yellow-500 text-white p-4 shadow-lg">
        <div class="container mx-auto flex justify-between items-center">
            <h1 class="text-xl font-bold"><i class="fas fa-comments mr-2"></i>オンラインチャット</h1>
            <nav class="flex space-x-4">
                <a href="/trade" class="hover:text-yellow-200"><i class="fas fa-chart-line mr-1"></i>トレード</a>
                <a href="/mypage" class="hover:text-yellow-200"><i class="fas fa-user mr-1"></i>マイページ</a>
                <a href="/ranking" class="hover:text-yellow-200"><i class="fas fa-trophy mr-1"></i>ランキング</a>
                <a href="/videos" class="hover:text-yellow-200"><i class="fas fa-video mr-1"></i>動画教材</a>
                <a href="/chat" class="hover:text-yellow-200"><i class="fas fa-comments mr-1"></i>チャット</a>
                <button onclick="logout()" class="hover:text-yellow-200"><i class="fas fa-sign-out-alt mr-1"></i>ログアウト</button>
            </nav>
        </div>
    </header>

    <div class="container mx-auto p-4 max-w-4xl">
        <div class="bg-white rounded-lg shadow-md flex flex-col" style="height: calc(100vh - 180px);">
            <!-- メッセージエリア -->
            <div id="messageArea" class="flex-1 overflow-y-auto p-4 space-y-3">
                <p class="text-center text-gray-500 py-4">読み込み中...</p>
            </div>

            <!-- 入力エリア -->
            <div class="border-t border-gray-200 p-4">
                <form id="messageForm" class="flex space-x-2">
                    <input 
                        type="text" 
                        id="messageInput" 
                        class="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500"
                        placeholder="メッセージを入力..."
                        required
                    />
                    <button 
                        type="submit"
                        class="bg-yellow-500 hover:bg-yellow-600 text-white px-6 py-2 rounded-lg font-bold"
                    >
                        <i class="fas fa-paper-plane mr-1"></i>送信
                    </button>
                </form>
            </div>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
    <script>
        let currentUserId = null;

        async function loadCurrentUser() {
            try {
                const response = await axios.get('/api/auth/me');
                currentUserId = response.data.id;
            } catch (error) {
                window.location.href = '/';
            }
        }

        async function loadMessages() {
            try {
                const response = await axios.get('/api/chat/messages');
                const messages = response.data;
                const container = document.getElementById('messageArea');
                
                if (messages.length === 0) {
                    container.innerHTML = '<p class="text-center text-gray-500 py-4">メッセージがありません</p>';
                    return;
                }

                container.innerHTML = messages.map(msg => {
                    const isMyMessage = msg.user_id === currentUserId;
                    const time = new Date(msg.created_at).toLocaleString('ja-JP', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                    
                    return \`
                        <div class="\${isMyMessage ? 'flex justify-end' : 'flex justify-start'}">
                            <div class="\${isMyMessage ? 'bg-yellow-100 border-yellow-300' : 'bg-gray-100 border-gray-300'} max-w-md px-4 py-2 rounded-lg border">
                                <div class="text-xs text-gray-600 mb-1">\${msg.username} · \${time}</div>
                                <div class="text-gray-800">\${msg.message}</div>
                            </div>
                        </div>
                    \`;
                }).join('');

                // 最新メッセージまでスクロール
                container.scrollTop = container.scrollHeight;
            } catch (error) {
                console.error('メッセージ取得エラー:', error);
            }
        }

        document.getElementById('messageForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = document.getElementById('messageInput');
            const message = input.value.trim();

            if (!message) return;

            try {
                await axios.post('/api/chat/messages', { message });
                input.value = '';
                await loadMessages();
            } catch (error) {
                alert('メッセージ送信に失敗しました');
            }
        });

        async function logout() {
            await axios.post('/api/auth/logout');
            window.location.href = '/';
        }

        loadCurrentUser();
        loadMessages();
        
        // 5秒ごとに新しいメッセージをチェック
        setInterval(loadMessages, 5000);
    </script>
</body>
</html>
  `)
})

// 管理者ダッシュボード
app.get('/admin', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>管理者ダッシュボード</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
</head>
<body class="bg-gray-100">
    <header class="bg-gradient-to-r from-red-600 to-red-500 text-white p-4 shadow-lg">
        <div class="container mx-auto flex justify-between items-center">
            <h1 class="text-xl font-bold"><i class="fas fa-user-shield mr-2"></i>管理者ダッシュボード</h1>
            <button onclick="logout()" class="hover:text-red-200">
                <i class="fas fa-sign-out-alt mr-1"></i>ログアウト
            </button>
        </div>
    </header>

    <div class="container mx-auto p-4 max-w-6xl">
        <!-- タブ -->
        <div class="flex space-x-2 mb-4">
            <button onclick="showTab('users')" id="usersTab" class="flex-1 bg-red-500 text-white font-bold py-3 rounded-lg shadow">
                <i class="fas fa-users mr-2"></i>ユーザー管理
            </button>
            <button onclick="showTab('videos')" id="videosTab" class="flex-1 bg-white text-gray-700 font-bold py-3 rounded-lg shadow">
                <i class="fas fa-video mr-2"></i>動画管理
            </button>
        </div>

        <!-- ユーザー管理 -->
        <div id="usersPanel" class="space-y-4">
            <!-- ユーザー追加フォーム -->
            <div class="bg-white rounded-lg shadow-md p-6">
                <h2 class="text-2xl font-bold mb-4">
                    <i class="fas fa-user-plus mr-2 text-red-500"></i>新規ユーザー追加
                </h2>
                <form id="addUserForm" class="space-y-4">
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">パスワード（数字6桁+英字1文字）</label>
                            <input 
                                type="text" 
                                id="newPassword" 
                                maxlength="7"
                                class="w-full px-4 py-2 border border-gray-300 rounded-lg"
                                placeholder="123456a"
                                required
                            />
                            <p class="text-xs text-gray-500 mt-1">例: 123456a, a234567, 12a3456</p>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">ユーザー名（任意）</label>
                            <input 
                                type="text" 
                                id="newUsername" 
                                class="w-full px-4 py-2 border border-gray-300 rounded-lg"
                                placeholder="空欄の場合は自動生成"
                            />
                        </div>
                    </div>
                    <button 
                        type="submit"
                        class="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-3 rounded-lg"
                    >
                        ユーザーを追加
                    </button>
                </form>
            </div>

            <!-- ユーザー一覧 -->
            <div class="bg-white rounded-lg shadow-md p-6">
                <h2 class="text-2xl font-bold mb-4">ユーザー一覧</h2>
                <div id="usersList" class="space-y-2 max-h-96 overflow-y-auto">
                    <p class="text-center text-gray-500 py-4">読み込み中...</p>
                </div>
            </div>
        </div>

        <!-- 動画管理 -->
        <div id="videosPanel" class="space-y-4 hidden">
            <!-- 動画追加フォーム -->
            <div class="bg-white rounded-lg shadow-md p-6">
                <h2 class="text-2xl font-bold mb-4">
                    <i class="fas fa-plus-circle mr-2 text-red-500"></i>動画追加
                </h2>
                <form id="addVideoForm" class="space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">タイトル</label>
                        <input 
                            type="text" 
                            id="videoTitle" 
                            class="w-full px-4 py-2 border border-gray-300 rounded-lg"
                            placeholder="例: エントリーの基礎"
                            required
                        />
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">YouTube URL</label>
                        <input 
                            type="url" 
                            id="videoUrl" 
                            class="w-full px-4 py-2 border border-gray-300 rounded-lg"
                            placeholder="https://youtu.be/..."
                            required
                        />
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">表示順序</label>
                        <input 
                            type="number" 
                            id="videoOrder" 
                            class="w-full px-4 py-2 border border-gray-300 rounded-lg"
                            placeholder="0"
                            value="0"
                        />
                    </div>
                    <button 
                        type="submit"
                        class="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-3 rounded-lg"
                    >
                        動画を追加
                    </button>
                </form>
            </div>

            <!-- 動画一覧 -->
            <div class="bg-white rounded-lg shadow-md p-6">
                <h2 class="text-2xl font-bold mb-4">動画一覧</h2>
                <div id="adminVideosList" class="space-y-2">
                    <p class="text-center text-gray-500 py-4">読み込み中...</p>
                </div>
            </div>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
    <script>
        function showTab(tab) {
            if (tab === 'users') {
                document.getElementById('usersPanel').classList.remove('hidden');
                document.getElementById('videosPanel').classList.add('hidden');
                document.getElementById('usersTab').className = 'flex-1 bg-red-500 text-white font-bold py-3 rounded-lg shadow';
                document.getElementById('videosTab').className = 'flex-1 bg-white text-gray-700 font-bold py-3 rounded-lg shadow';
            } else {
                document.getElementById('usersPanel').classList.add('hidden');
                document.getElementById('videosPanel').classList.remove('hidden');
                document.getElementById('usersTab').className = 'flex-1 bg-white text-gray-700 font-bold py-3 rounded-lg shadow';
                document.getElementById('videosTab').className = 'flex-1 bg-red-500 text-white font-bold py-3 rounded-lg shadow';
            }
        }

        async function loadUsers() {
            try {
                const response = await axios.get('/api/admin/users');
                const users = response.data;
                const container = document.getElementById('usersList');
                
                container.innerHTML = users.map(user => {
                    const date = new Date(user.created_at).toLocaleDateString('ja-JP');
                    const profitColor = user.total_profit >= 0 ? 'text-green-600' : 'text-red-600';
                    
                    return \`
                        <div class="border border-gray-200 rounded-lg p-4">
                            <div class="grid grid-cols-4 gap-4">
                                <div>
                                    <div class="text-sm text-gray-500">ユーザー名</div>
                                    <div class="font-bold">\${user.username}</div>
                                </div>
                                <div>
                                    <div class="text-sm text-gray-500">パスワード</div>
                                    <div class="font-mono font-bold">\${user.password}</div>
                                </div>
                                <div>
                                    <div class="text-sm text-gray-500">残高</div>
                                    <div class="font-bold">¥\${user.balance.toLocaleString()}</div>
                                </div>
                                <div>
                                    <div class="text-sm text-gray-500">総利益</div>
                                    <div class="font-bold \${profitColor}">¥\${user.total_profit.toLocaleString()}</div>
                                </div>
                            </div>
                            <div class="mt-2 text-xs text-gray-500">
                                取引数: \${user.total_trades} | ポイント: \${user.points}pt | 登録日: \${date}
                            </div>
                        </div>
                    \`;
                }).join('');
            } catch (error) {
                console.error('ユーザー取得エラー:', error);
                if (error.response?.status === 403) {
                    alert('管理者権限がありません');
                    window.location.href = '/admin-login';
                }
            }
        }

        async function loadAdminVideos() {
            try {
                const response = await axios.get('/api/videos');
                const videos = response.data;
                const container = document.getElementById('adminVideosList');
                
                if (videos.length === 0) {
                    container.innerHTML = '<p class="text-center text-gray-500 py-4">動画がありません</p>';
                    return;
                }

                container.innerHTML = videos.map(video => \`
                    <div class="border border-gray-200 rounded-lg p-4 flex justify-between items-center">
                        <div class="flex-1">
                            <h3 class="font-bold text-gray-800">\${video.title}</h3>
                            <a href="\${video.youtube_url}" target="_blank" class="text-sm text-blue-600 hover:text-blue-800">
                                \${video.youtube_url}
                            </a>
                            <div class="text-xs text-gray-500 mt-1">表示順序: \${video.order_index}</div>
                        </div>
                        <button 
                            onclick="deleteVideo(\${video.id})" 
                            class="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg"
                        >
                            <i class="fas fa-trash mr-1"></i>削除
                        </button>
                    </div>
                \`).join('');
            } catch (error) {
                console.error('動画取得エラー:', error);
            }
        }

        document.getElementById('addUserForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const password = document.getElementById('newPassword').value;
            const username = document.getElementById('newUsername').value;

            try {
                const response = await axios.post('/api/admin/users', { password, username });
                alert(\`ユーザーを追加しました\\nユーザー名: \${response.data.username}\\nパスワード: \${response.data.password}\`);
                document.getElementById('addUserForm').reset();
                await loadUsers();
            } catch (error) {
                alert('エラー: ' + (error.response?.data?.error || 'ユーザー追加に失敗しました'));
            }
        });

        document.getElementById('addVideoForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const title = document.getElementById('videoTitle').value;
            const youtubeUrl = document.getElementById('videoUrl').value;
            const orderIndex = parseInt(document.getElementById('videoOrder').value) || 0;

            try {
                await axios.post('/api/admin/videos', { title, youtubeUrl, orderIndex });
                alert('動画を追加しました');
                document.getElementById('addVideoForm').reset();
                await loadAdminVideos();
            } catch (error) {
                alert('エラー: ' + (error.response?.data?.error || '動画追加に失敗しました'));
            }
        });

        async function deleteVideo(id) {
            if (!confirm('この動画を削除しますか？')) return;

            try {
                await axios.delete(\`/api/admin/videos/\${id}\`);
                alert('動画を削除しました');
                await loadAdminVideos();
            } catch (error) {
                alert('削除に失敗しました');
            }
        }

        async function logout() {
            await axios.post('/api/auth/logout');
            window.location.href = '/admin-login';
        }

        // 数字と英字のみ入力許可
        document.getElementById('newPassword').addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/[^0-9a-zA-Z]/g, '');
        });

        loadUsers();
        loadAdminVideos();
    </script>
</body>
</html>
  `)
})

export default app
