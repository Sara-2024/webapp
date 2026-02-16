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

// ユーティリティ関数：ユーザーアクティビティ更新
async function updateUserActivity(db: D1Database, userId: number) {
  await db.prepare(`
    UPDATE users SET last_activity_at = CURRENT_TIMESTAMP WHERE id = ?
  `).bind(userId).run()
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
      SET last_login_date = ?, consecutive_login_days = ?, last_activity_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(today, consecutiveDays, user.id).run()
  } else {
    // 既にログイン済みでも、最終アクティビティ時刻を更新
    await c.env.DB.prepare(`
      UPDATE users 
      SET last_activity_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(user.id).run()
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

// 新規登録
app.post('/api/auth/register', async (c) => {
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

  // 🔒 重複チェック：既に同じパスワードのユーザーが存在するか確認
  const existingUser = await c.env.DB.prepare(`
    SELECT id FROM users WHERE password = ?
  `).bind(password).first()

  if (existingUser) {
    return c.json({ 
      error: 'このパスワードは既に使用されています。別のパスワードを入力してください',
      alreadyExists: true 
    }, 409)  // 409 Conflict
  }

  // ランダムなユーザー名を生成
  const username = generateRandomUsername()

  // ユーザー作成
  const result = await c.env.DB.prepare(`
    INSERT INTO users (password, username, balance, points)
    VALUES (?, ?, 1000000.0, 0)
  `).bind(password, username).run()

  const userId = result.meta.last_row_id

  // 登録ボーナスポイント付与
  await addPoints(c.env.DB, userId, 100, 'REGISTRATION', '新規登録ボーナス')

  // セッション設定
  setCookie(c, 'user_id', String(userId), {
    httpOnly: true,
    secure: true,
    maxAge: 60 * 60 * 24 * 7 // 7日間
  })

  return c.json({ 
    success: true,
    user: {
      id: userId,
      username: username,
      balance: 1000000.0,
      points: 100
    },
    message: '登録が完了しました！100ポイント獲得！'
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

  // ユーザーアクティビティ更新
  await updateUserActivity(c.env.DB, parseInt(userId))

  const { type, amount, price } = await c.req.json()
  
  if (type !== 'BUY' && type !== 'SELL') {
    return c.json({ error: '無効な取引タイプ' }, 400)
  }

  // クライアントから送られた価格を使用（フロントエンドの表示価格と一致）
  // フォールバック：価格が送られてこない場合はDBから取得
  let entryPrice = price
  
  console.log('[Server] Entry request:', { type, amount, price, hasPrice: !!price })
  
  if (!entryPrice) {
    const latestCandle = await c.env.DB.prepare(`
      SELECT close FROM gold10_candles
      ORDER BY timestamp DESC
      LIMIT 1
    `).first()
    entryPrice = latestCandle ? latestCandle.close as number : 5000
    console.log('[Server] Using fallback price from DB:', entryPrice)
  }

  const result = await c.env.DB.prepare(`
    INSERT INTO trades (user_id, type, amount, entry_price, status)
    VALUES (?, ?, ?, ?, 'OPEN')
  `).bind(userId, type, amount, entryPrice).run()
  
  console.log('[Server] Trade created:', { tradeId: result.meta.last_row_id, entryPrice })

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

  // クライアントから送られた価格を使用、なければDBから取得
  const body = await c.req.json().catch(() => ({}))
  let exitPrice = body.price
  
  if (!exitPrice) {
    exitPrice = await getGold10Price(c.env.DB)
  }
  
  const entryPrice = trade.entry_price as number
  const amount = trade.amount as number
  const type = trade.type as string

  // 損益計算（GOLD10の場合）
  // 1ロット = 100オンス、USD/JPY = 152.96
  // 価格差1ドル × 100オンス × 152.96円/ドル = 15,296円
  let profitLoss = 0
  if (type === 'BUY') {
    profitLoss = (exitPrice - entryPrice) * amount * 100 * 152.96
  } else {
    profitLoss = (entryPrice - exitPrice) * amount * 100 * 152.96
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

// 15分経過ポジションの自動決済
app.post('/api/trade/auto-close-expired', async (c) => {
  const userId = getCookie(c, 'user_id')
  if (!userId) {
    return c.json({ error: '未認証' }, 401)
  }

  try {
    // 15分以上経過したオープンポジションを取得
    // SQLiteフォーマットに変換: 'YYYY-MM-DD HH:MM:SS' (TではなくスペースでISOのZを削除)
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000)
      .toISOString()
      .replace('T', ' ')
      .substring(0, 19)  // ミリ秒とZを削除
    
    const { results: expiredTrades } = await c.env.DB.prepare(`
      SELECT * FROM trades 
      WHERE user_id = ? AND status = 'OPEN' AND entry_time <= ?
    `).bind(userId, fifteenMinutesAgo).all()

    if (!expiredTrades || expiredTrades.length === 0) {
      return c.json({ closedCount: 0 })
    }

    // GOLD10の最新価格を取得
    const exitPrice = await getGold10Price(c.env.DB)
    const exitTime = new Date().toISOString()
    let totalClosedProfit = 0

    // 各ポジションを決済
    for (const trade of expiredTrades) {
      const entryPrice = trade.entry_price as number
      const amount = trade.amount as number
      const type = trade.type as string

      // 損益計算
      let profitLoss = 0
      if (type === 'BUY') {
        profitLoss = (exitPrice - entryPrice) * amount * 152.96
      } else {
        profitLoss = (entryPrice - exitPrice) * amount * 152.96
      }

      totalClosedProfit += profitLoss

      // トレード更新
      await c.env.DB.prepare(`
        UPDATE trades 
        SET exit_price = ?, profit_loss = ?, status = 'CLOSED', exit_time = ?
        WHERE id = ?
      `).bind(exitPrice, profitLoss, exitTime, trade.id).run()

      // ユーザーの残高と統計更新
      await c.env.DB.prepare(`
        UPDATE users 
        SET balance = balance + ?, 
            total_profit = total_profit + ?,
            total_trades = total_trades + 1
        WHERE id = ?
      `).bind(profitLoss, profitLoss, userId).run()
    }

    return c.json({ 
      closedCount: expiredTrades.length,
      totalProfit: totalClosedProfit
    })
  } catch (error) {
    console.error('Auto-close error:', error)
    return c.json({ error: '自動決済エラー' }, 500)
  }
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

// AIフィードバック取得
app.get('/api/trade/ai-feedback', async (c) => {
  const userId = getCookie(c, 'user_id')
  if (!userId) {
    return c.json({ error: '未認証' }, 401)
  }

  try {
    // 最近50件の取引履歴を取得
    const { results: trades } = await c.env.DB.prepare(`
      SELECT * FROM trades 
      WHERE user_id = ? AND status = 'CLOSED'
      ORDER BY exit_time DESC
      LIMIT 50
    `).bind(userId).all()

    if (!trades || trades.length === 0) {
      return c.json({ 
        feedback: '取引履歴がまだありません。まずはトレードを始めてみましょう！' 
      })
    }

    // 取引統計を計算
    const totalTrades = trades.length
    const winTrades = trades.filter((t: any) => t.profit_loss > 0).length
    const lossTrades = trades.filter((t: any) => t.profit_loss <= 0).length
    const winRate = ((winTrades / totalTrades) * 100).toFixed(1)
    const totalProfit = trades.reduce((sum: number, t: any) => sum + (t.profit_loss || 0), 0)
    const avgProfit = (totalProfit / totalTrades).toFixed(2)
    
    // 買いと売りの統計
    const buyTrades = trades.filter((t: any) => t.type === 'BUY')
    const sellTrades = trades.filter((t: any) => t.type === 'SELL')
    const buyWinRate = buyTrades.length > 0 
      ? ((buyTrades.filter((t: any) => t.profit_loss > 0).length / buyTrades.length) * 100).toFixed(1)
      : 0
    const sellWinRate = sellTrades.length > 0
      ? ((sellTrades.filter((t: any) => t.profit_loss > 0).length / sellTrades.length) * 100).toFixed(1)
      : 0

    // 1日あたりの取引数を計算
    const dates = [...new Set(trades.map((t: any) => new Date(t.exit_time).toDateString()))]
    const tradesPerDay = (totalTrades / dates.length).toFixed(1)

    // 負けトレードの分析
    const lossTradePrices = trades
      .filter((t: any) => t.profit_loss <= 0)
      .map((t: any) => ({ entry: t.entry_price, exit: t.exit_price, type: t.type }))

    // 直近のサイン情報を取得
    const { results: recentSignals } = await c.env.DB.prepare(`
      SELECT timestamp, type, price, rsi FROM gold10_signals
      ORDER BY timestamp DESC
      LIMIT 10
    `).all()

    // 現在のGOLD10チャート状況を取得（最新20本のローソク足）
    const { results: recentCandles } = await c.env.DB.prepare(`
      SELECT timestamp, close, rsi FROM gold10_candles
      ORDER BY timestamp DESC
      LIMIT 20
    `).all()

    // 現在のRSI状態を分析
    const currentRSI = recentCandles.length > 0 ? recentCandles[0].rsi : null
    let rsiStatus = '中立'
    if (currentRSI) {
      if (currentRSI >= 70) rsiStatus = '買われすぎ（売りチャンス）'
      else if (currentRSI <= 30) rsiStatus = '売られすぎ（買いチャンス）'
      else if (currentRSI >= 36 && currentRSI <= 60) rsiStatus = '理想的な範囲'
    }

    // トレンド分析（最新20本の終値）
    const prices = recentCandles.map((c: any) => c.close)
    const avgPrice = prices.reduce((a: number, b: number) => a + b, 0) / prices.length
    const latestPrice = prices[0]
    const priceChange = ((latestPrice - avgPrice) / avgPrice * 100).toFixed(2)
    let trendStatus = '横ばい'
    if (parseFloat(priceChange) > 0.5) trendStatus = '上昇トレンド'
    else if (parseFloat(priceChange) < -0.5) trendStatus = '下降トレンド'

    // ChatGPT APIを呼び出してフィードバックを生成
    const apiKey = c.env.OPENAI_API_KEY
    if (!apiKey) {
      return c.json({ 
        feedback: `総取引: ${totalTrades}回 | 勝率: ${winRate}% | 総損益: ¥${totalProfit.toLocaleString()}\n\n取引を続けて、パターンを見つけましょう！` 
      })
    }

    const prompt = `あなたはプロのトレーディングコーチです。以下の取引データとリアルタイム市場情報を分析して、具体的で実践的なフィードバックを必ず3〜4行提供してください。

【取引統計】
- 総取引数: ${totalTrades}回
- 勝率: ${winRate}% (目標: 60%)
- 勝ち: ${winTrades}回 / 負け: ${lossTrades}回
- 総損益: ¥${totalProfit.toLocaleString()}
- 平均損益: ¥${avgProfit}
- 買いの勝率: ${buyWinRate}% / 売りの勝率: ${sellWinRate}%
- 1日あたりの取引数: ${tradesPerDay}回 (目標: 2回以上)

【リアルタイム市場分析】
- 現在のRSI: ${currentRSI ? currentRSI.toFixed(1) : '不明'} (${rsiStatus})
- 現在の価格トレンド: ${trendStatus} (直近20本平均から${priceChange}%)
- 最新のGOLD価格: $${latestPrice ? latestPrice.toFixed(2) : '不明'}
- 直近のサイン数: ${recentSignals.length}件

【重要：必ず3行または4行を出力してください】
以下の4つのテーマから、必ず3つまたは4つを選んで1行ずつ記述してください。
1. **現在のRSI状況**: 現在のRSI ${currentRSI ? currentRSI.toFixed(1) : '--'} から見たエントリータイミングの評価
2. **トレンド分析**: 現在の${trendStatus}に対する推奨アクション（順張り/逆張り）
3. **勝率とRSI活用**: ユーザーの勝率${winRate}%とRSI 36-60での取引意識の関連性
4. **サイン活用度または取引頻度**: 直近のサイン${recentSignals.length}件の活用 または 1日の取引回数

【厳格な出力ルール】
✅ 必ず3行または4行を出力（2行は不可）
✅ 各行は40〜60文字程度
✅ 各行の先頭に絵文字を1つ付ける（📊 📈 📉 ⚠️ ✨ ⏰ 🎯 など）
✅ 各行は改行で区切る
✅ インジケーター（RSI）、トレンド、サインを必ず含める

【出力例（必ず真似してください）】:
📊 現在RSI ${currentRSI ? currentRSI.toFixed(1) : '--'}（${rsiStatus}）｜勝率${winRate}%でRSI理想範囲での取引を意識すると60%到達可能
📈 ${trendStatus}が継続中｜順張りエントリーを狙い、RSI 36-60で仕掛けると成功率UP
⚠️ 直近サイン${recentSignals.length}件｜サイン点灯時の即エントリーを心がけると精度向上します
${parseFloat(tradesPerDay) >= 2 ? '✨ 1日2回以上達成！この調子でトレンドを味方につけましょう' : '⏰ 1日2回以上を目標に、トレンドの波に乗るタイミングを増やしましょう'}

上記の例のように、必ず3行または4行で出力してください。`

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'あなたはプロのトレーディングコーチです。必ず3行または4行のフィードバックを提供してください。2行は絶対に不可です。各行は絵文字で始まり、40〜60文字程度です。RSI、トレンド、サイン活用のいずれかを必ず含めてください。' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 500,
        temperature: 0.8
      })
    })

    const data = await response.json()
    
    if (data.choices && data.choices[0]?.message?.content) {
      return c.json({ 
        feedback: data.choices[0].message.content,
        stats: {
          totalTrades,
          winRate,
          totalProfit,
          buyWinRate,
          sellWinRate,
          tradesPerDay
        }
      })
    }

    // APIエラー時のフォールバック
    return c.json({ 
      feedback: `📊 総取引: ${totalTrades}回 | 勝率: ${winRate}%\n💰 総損益: ¥${totalProfit.toLocaleString()}\n\n取引を続けて、パターンを見つけましょう！` 
    })

  } catch (error) {
    console.error('AI Feedback error:', error)
    return c.json({ 
      feedback: '分析中にエラーが発生しました。もう一度お試しください。' 
    }, 500)
  }
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
  const hoursParam = c.req.query('hours')
  const limitParam = c.req.query('limit')
  
  // limitパラメータが指定されている場合はそれを使用、なければhoursから計算
  let limit
  if (limitParam) {
    limit = parseInt(limitParam)
  } else {
    const hours = parseInt(hoursParam || '12')
    limit = hours * 60  // 1分足なので、時間 × 60本
  }
  
  // 🔒 現在時刻以前のローソク足のみを取得（未来のローソク足は除外）
  const now = Math.floor(Date.now() / 1000)
  const candles = await c.env.DB.prepare(`
    SELECT * FROM gold10_candles
    WHERE timestamp <= ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).bind(now, limit).all()

  // 新しい順→古い順に並び替え
  const sortedCandles = candles.results.reverse()
  
  return c.json(sortedCandles)
})

// Server-side candle generation helper
async function generateCandleIfNeeded(db: D1Database): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000)
  
  // Get the latest candle
  const latest = await db.prepare(`
    SELECT timestamp, close FROM gold10_candles 
    ORDER BY timestamp DESC 
    LIMIT 1
  `).first()

  if (!latest) {
    return false
  }

  // Check if we need to generate a new candle (30+ seconds since last)
  const timeSinceLast = now - latest.timestamp
  if (timeSinceLast < 30) {
    return false
  }

  // Calculate how many candles we need to generate
  const candlesToGenerate = Math.floor(timeSinceLast / 30)
  
  // Generate missing candles (but limit to prevent too many at once)
  const maxToGenerate = Math.min(candlesToGenerate, 10)
  
  let lastClose = latest.close
  for (let i = 0; i < maxToGenerate; i++) {
    const candleTime = latest.timestamp + (i + 1) * 30
    const newCandle = await generateSingleCandle(db, candleTime, lastClose)
    lastClose = newCandle.close  // 次のローソク足は今のローソク足の終値から始まる
  }

  return true
}

async function generateSingleCandle(db: D1Database, candleTime: number, previousClose: number): Promise<{close: number}> {
  const open = previousClose

  // より自然なローソク足を生成（始値から変化する）
  const trendDirection = Math.random() > 0.5 ? 1 : -1
  const trendStrength = 0.1 + Math.random() * 0.3  // 0.1-0.4 USD
  const volatility = 0.05 + Math.random() * 0.1   // 0.05-0.15 USD

  const prices = []
  let currentPrice = open

  // 10回の価格変動をシミュレート
  for (let i = 0; i < 10; i++) {
    const trendComponent = trendDirection * trendStrength
    const randomWalk = (Math.random() - 0.5) * volatility * 2
    currentPrice = currentPrice + trendComponent + randomWalk
    prices.push(currentPrice)
  }

  const close = prices[prices.length - 1]
  const high = Math.max(open, close, ...prices)
  const low = Math.min(open, close, ...prices)

  // Calculate RSI (simplified - just use 50 for now)
  const rsi = 50

  // Save to DB
  await db.prepare(`
    INSERT OR IGNORE INTO gold10_candles (timestamp, open, high, low, close, rsi)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(candleTime, open, high, low, close, rsi).run()

  console.log(`[Server] Generated candle at ${new Date(candleTime * 1000).toISOString()} - Open:${open.toFixed(2)} Close:${close.toFixed(2)}`)
  
  return { close }  // 次のローソク足で使うためにcloseを返す
}

// Get latest candles with countdown info
app.get('/api/gold10/candles/latest', async (c) => {
  // Try to generate new candles if needed
  await generateCandleIfNeeded(c.env.DB)
  
  const limit = parseInt(c.req.query('limit') || '100')
  
  // Get latest candles from DB
  const candles = await c.env.DB.prepare(`
    SELECT timestamp, open, high, low, close, rsi FROM gold10_candles
    ORDER BY timestamp DESC
    LIMIT ?
  `).bind(limit).all()

  // Calculate countdown
  const now = Math.floor(Date.now() / 1000)
  const latestCandle = candles.results[0]
  
  // 次のローソク足の時刻を計算（30秒刻み）
  // now を 30秒単位に切り捨て → 30秒足す = 次の30秒境界
  const next30SecBoundary = Math.floor(now / 30) * 30 + 30
  
  let nextCandleTime
  if (latestCandle) {
    // 最新ローソク足から30秒後
    nextCandleTime = latestCandle.timestamp + 30
    
    // もし過去の場合は、次の30秒境界を使う
    if (nextCandleTime <= now) {
      nextCandleTime = next30SecBoundary
    }
  } else {
    // ローソク足がない場合、次の30秒境界
    nextCandleTime = next30SecBoundary
  }
  
  const secondsUntilNext = Math.max(0, nextCandleTime - now)
  
  console.log(`[Server] Countdown: now=${now}, nextCandleTime=${nextCandleTime}, secondsUntilNext=${secondsUntilNext}`)

  return c.json({
    candles: candles.results.reverse(),
    nextCandleTime: nextCandleTime,
    secondsUntilNext: secondsUntilNext,
    serverTime: now
  })
})

// 最新のローソク足データを取得
app.get('/api/gold10/latest', async (c) => {
  // 🔒 現在時刻以前の最新ローソク足のみを取得
  const now = Math.floor(Date.now() / 1000)
  const latestCandle = await c.env.DB.prepare(`
    SELECT * FROM gold10_candles
    WHERE timestamp <= ?
    ORDER BY timestamp DESC
    LIMIT 1
  `).bind(now).first()

  const latestSignals = await c.env.DB.prepare(`
    SELECT * FROM gold10_signals
    WHERE timestamp <= ?
    ORDER BY timestamp DESC
    LIMIT 10
  `).bind(now).all()

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
// GETとPOSTの両方をサポート（外部Cronサービスから呼び出し可能）
// ========== GOLD10 APIエンドポイント（ローソク足関連は管理者モニターのみで生成） ==========

// ローソク足の存在確認
app.get('/api/gold10/candle-exists', async (c) => {
  const timestamp = parseInt(c.req.query('timestamp') || '0')

  if (!timestamp) {
    return c.json({ error: 'timestamp パラメータが必要です' }, 400)
  }

  const candle = await c.env.DB.prepare(`
    SELECT id FROM gold10_candles WHERE timestamp = ?
  `).bind(timestamp).first()

  return c.json({ exists: !!candle })
})

// 管理者：ローソク足を直接保存（管理者権限チェックなし）
app.post('/api/admin/gold10/save-candle', async (c) => {
  const { timestamp, open, high, low, close } = await c.req.json()
  
  if (!timestamp || !open || !high || !low || !close) {
    return c.json({ error: '必須パラメータが不足しています' }, 400)
  }

  // 同じタイムスタンプのローソク足が既に存在するかチェック
  const existingCandle = await c.env.DB.prepare(`
    SELECT id FROM gold10_candles WHERE timestamp = ?
  `).bind(timestamp).first()

  if (existingCandle) {
    return c.json({ 
      success: false,
      message: 'このタイムスタンプのローソク足は既に存在します',
      timestamp: timestamp,
      existingId: existingCandle.id
    })
  }

  // ローソク足をDBに保存
  const insertResult = await c.env.DB.prepare(`
    INSERT INTO gold10_candles (timestamp, open, high, low, close)
    VALUES (?, ?, ?, ?, ?)
  `).bind(timestamp, open, high, low, close).run()

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

  return c.json({
    success: true,
    candle: { id: candleId, timestamp, open, high, low, close, rsi },
    message: 'ローソク足を保存しました'
  })
})

// 【新価格生成エンジン】ユーザーエントリー影響を記録
app.post('/api/gold10/trade-impact', async (c) => {
  const { type, timestamp } = await c.req.json()
  
  if (!type || !timestamp) {
    return c.json({ error: 'パラメータが不足しています' }, 400)
  }
  
  // トレード影響をメモリに記録（KV使用も可）
  // direction: BUY=+1, SELL=-1
  const direction = type === 'BUY' ? 1 : -1
  const impactStrength = 0.15 // 現在変動幅の15%
  
  return c.json({
    success: true,
    direction,
    impactStrength,
    timestamp
  })
})

// 【新価格生成エンジン】次の30秒足を生成
app.post('/api/gold10/generate-next-candle', async (c) => {
  // ⚠️ デバッグ用：リクエスト元を記録
  const clientIP = c.req.header('CF-Connecting-IP') || c.req.header('X-Real-IP') || 'unknown';
  const userAgent = c.req.header('User-Agent') || 'unknown';
  console.log(`[CANDLE-GEN] Request from IP: ${clientIP}, User-Agent: ${userAgent}`);
  
  // リクエストボディから指定タイムスタンプを取得（任意）
  let customTimestamp = null
  try {
    const body = await c.req.json()
    customTimestamp = body.timestamp
    console.log(`[CANDLE-GEN] Custom timestamp: ${customTimestamp}`);
  } catch (e) {
    // JSON パースエラー時は無視（ボディなし）
    console.log(`[CANDLE-GEN] No custom timestamp (using current time)`);
  }
  
  let candleTime
  const now = Math.floor(Date.now() / 1000)
  
  if (customTimestamp) {
    // カスタムタイムスタンプ（過去・現在・未来すべて許可 - 重複チェックで防御）
    candleTime = Math.floor(customTimestamp / 30) * 30 // 30秒境界に揃える
  } else {
    // 現在時刻（通常運用）
    candleTime = Math.floor(now / 30) * 30
  }
  
  // 重複チェック
  const existing = await c.env.DB.prepare(`
    SELECT id FROM gold10_candles WHERE timestamp = ?
  `).bind(candleTime).first()
  
  if (existing) {
    return c.json({ 
      success: false, 
      message: 'このタイムスタンプは既に存在します',
      timestamp: candleTime
    })
  }
  
  // 前回のローソク足を取得（指定タイムスタンプの直前）
  const prevCandle = await c.env.DB.prepare(`
    SELECT * FROM gold10_candles 
    WHERE timestamp < ?
    ORDER BY timestamp DESC LIMIT 1
  `).bind(candleTime).first()
  
  // 【慣性導入】過去3本の足を取得してボラティリティ計算
  const recentCandles = await c.env.DB.prepare(`
    SELECT * FROM gold10_candles 
    WHERE timestamp < ?
    ORDER BY timestamp DESC LIMIT 5
  `).bind(candleTime).all()
  
  const recent = recentCandles.results as any[]
  
  // 初期価格または連続価格
  let basePrice = prevCandle ? prevCandle.close : 4925.0
  
  // 【慣性導入】前の足の方向を判定
  let prevDirection = 0 // 0: 初回, 1: 陽線, -1: 陰線
  let prevBodySize = 0
  if (prevCandle) {
    const prevChange = prevCandle.close - prevCandle.open
    prevDirection = prevChange > 0 ? 1 : (prevChange < 0 ? -1 : 0)
    prevBodySize = Math.abs(prevChange)
  }
  
  // 【慣性導入】過去3〜5本の平均ボラティリティを計算
  let avgVolatility = 0.05 // デフォルト
  if (recent.length >= 3) {
    let totalVol = 0
    for (let i = 0; i < Math.min(3, recent.length); i++) {
      const c = recent[i]
      const vol = c.high - c.low
      totalVol += vol
    }
    avgVolatility = totalVol / Math.min(3, recent.length)
  }
  
  // 30秒区間の1秒ごと価格を生成（内部計算用）
  const prices: number[] = []
  let currentPrice = basePrice
  
  // 【慣性導入】トレンド方向を前足の方向に従う確率を持たせる（60-70%）
  let trendDirection = 0
  if (prevDirection !== 0) {
    // 60-70%の確率で前足の方向を引き継ぐ
    const momentum = Math.random()
    if (momentum < 0.65) {
      trendDirection = prevDirection
    } else {
      trendDirection = -prevDirection
    }
  } else {
    trendDirection = Math.random() > 0.5 ? 1 : -1
  }
  
  // 【慣性導入】方向転換時は小さな変動から始める
  let trendStrength = 0.05 + Math.random() * 0.15 // 0.05-0.2ドル
  if (prevDirection !== 0 && trendDirection !== prevDirection) {
    // 方向転換：強度を30-50%に抑える
    trendStrength = trendStrength * (0.3 + Math.random() * 0.2)
  } else if (prevDirection !== 0 && trendDirection === prevDirection) {
    // 継続：前回の足のサイズに応じて調整
    if (prevBodySize > 10) {
      // 大きな足の後は少し抑える
      trendStrength = trendStrength * 0.7
    }
  }
  
  // 【慣性導入】ボラティリティは過去平均の80-120%の範囲で徐々に変化
  const targetVolatility = avgVolatility * (0.8 + Math.random() * 0.4)
  const volatility = Math.max(0.02, Math.min(0.15, targetVolatility))
  
  // 【慣性導入】トレンドの加速度（序盤は弱く、中盤で強く、終盤でまた弱める）
  for (let i = 0; i < 30; i++) {
    // 市場変動成分（平均回帰）
    const meanReversion = (4925 - currentPrice) * 0.001 // 中心価格への微弱な引力
    
    // 【慣性導入】トレンド成分：序盤・終盤は弱く、中盤は強い
    const progress = i / 30
    let accelerationFactor = 1.0
    if (progress < 0.3) {
      // 序盤：70-90%
      accelerationFactor = 0.7 + progress
    } else if (progress > 0.7) {
      // 終盤：100-70%
      accelerationFactor = 1.0 - (progress - 0.7) * 1.0
    } else {
      // 中盤：100-120%
      accelerationFactor = 1.0 + (progress - 0.3) * 0.5
    }
    
    const trendComponent = trendDirection * trendStrength * accelerationFactor / 30
    
    // ランダムウォーク成分
    const randomWalk = (Math.random() - 0.5) * volatility
    
    // ユーザー影響成分（仮：簡易実装、後でDB/KVから取得可能）
    // 実際には直近のトレードを取得して影響を計算
    const userImpact = 0 // 今回は簡易実装
    
    // 次の価格
    currentPrice = currentPrice + meanReversion + trendComponent + randomWalk + userImpact
    
    // 価格範囲制限を削除：自然な市場価格変動を許可
    // 旧コード: currentPrice = Math.max(4900, Math.min(4945, currentPrice))
    
    prices.push(currentPrice)
  }
  
  // 30秒足の四本値を計算
  const open = basePrice // Next_Open = Previous_Close
  const close = prices[prices.length - 1]
  const high = Math.max(...prices)
  const low = Math.min(...prices)
  
  // DBに保存
  const insertResult = await c.env.DB.prepare(`
    INSERT INTO gold10_candles (timestamp, open, high, low, close)
    VALUES (?, ?, ?, ?, ?)
  `).bind(candleTime, open, high, low, close).run()
  
  const candleId = insertResult.meta.last_row_id
  
  // RSI計算
  const recentCandlesForRSI = await c.env.DB.prepare(`
    SELECT * FROM gold10_candles ORDER BY timestamp DESC LIMIT 15
  `).all()
  
  const candlesForRSI = recentCandlesForRSI.results.reverse() as any[]
  const rsi = calculateRSI(candlesForRSI, 14)
  
  await c.env.DB.prepare(`
    UPDATE gold10_candles SET rsi = ? WHERE id = ?
  `).bind(rsi, candleId).run()
  
  return c.json({
    success: true,
    candle: { id: candleId, timestamp: candleTime, open, high, low, close, rsi },
    message: '30秒足を生成しました'
  })
})


// 管理者：即座にサイン生成
app.post('/api/admin/gold10/generate-signal', async (c) => {
  const adminId = getCookie(c, 'admin_id')
  if (!adminId) {
    return c.json({ error: '管理者権限が必要です' }, 403)
  }

  const { type } = await c.req.json()
  if (!type || (type !== 'BUY' && type !== 'SELL')) {
    return c.json({ error: 'サインタイプが不正です' }, 400)
  }

  // 最新のローソク足を取得
  const latestCandle = await c.env.DB.prepare(`
    SELECT * FROM gold10_candles ORDER BY timestamp DESC LIMIT 1
  `).first()

  if (!latestCandle) {
    return c.json({ error: 'ローソク足データがありません' }, 400)
  }

  // RSIを取得（なければ50とする）
  const rsi = latestCandle.rsi || 50

  // サイン価格（現在価格）
  const price = latestCandle.close

  // 目標価格（約5ドル先）
  const targetMove = 4.5 + Math.random() * 1.0  // $4.5-$5.5
  const target_price = type === 'BUY' 
    ? price + targetMove 
    : price - targetMove

  // 勝率75%でランダムに成功/失敗を決定
  const success = Math.random() < 0.75 ? 1 : 0

  // サインをDBに保存
  await c.env.DB.prepare(`
    INSERT INTO gold10_signals (candle_id, timestamp, type, price, target_price, success, rsi)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    latestCandle.id,
    latestCandle.timestamp,
    type,
    price,
    target_price,
    success,
    rsi
  ).run()

  // 勝率75%になるように相場を動かす（次の3〜5本のローソク足を調整）
  const adjustmentCandles = 3 + Math.floor(Math.random() * 3) // 3-5本
  const priceChange = success === 1 
    ? (type === 'BUY' ? targetMove : -targetMove)
    : (type === 'BUY' ? -targetMove * 0.5 : targetMove * 0.5)

  // 次のローソク足生成時に価格調整が反映されるようにフラグを設定（簡易実装）
  // 実際の価格調整は次回のgenerateCandleで行う

  return c.json({
    success: true,
    signal: {
      type,
      price,
      target_price,
      timestamp: latestCandle.timestamp,
      success
    },
    message: `${type === 'BUY' ? '買い' : '売り'}サインを生成しました`
  })
})

// 管理者：サイン予約
app.post('/api/admin/gold10/reserve-signal', async (c) => {
  const adminId = getCookie(c, 'admin_id')
  if (!adminId) {
    return c.json({ error: '管理者権限が必要です' }, 403)
  }

  const { type, hours } = await c.req.json()
  if (!type || (type !== 'BUY' && type !== 'SELL')) {
    return c.json({ error: 'サインタイプが不正です' }, 400)
  }
  if (!hours || hours < 1 || hours > 6) {
    return c.json({ error: '予約時間は1〜6時間です' }, 400)
  }

  // 予約時刻を計算（UTC）
  const reserveTime = Math.floor(Date.now() / 1000) + (hours * 60 * 60)

  // 予約をDBに保存
  await c.env.DB.prepare(`
    INSERT INTO gold10_signal_reservations (type, reserve_time)
    VALUES (?, ?)
  `).bind(type, reserveTime).run()
  
  return c.json({
    success: true,
    reservation: {
      type,
      hours,
      reserveTime,
      reserveTimeStr: new Date(reserveTime * 1000).toISOString()
    },
    message: `${hours}時間後に${type === 'BUY' ? '買い' : '売り'}サインを予約しました`
  })
})

// 予約サイン一覧取得
app.get('/api/admin/gold10/reserved-signals', async (c) => {
  const adminId = getCookie(c, 'admin_id')
  if (!adminId) {
    return c.json({ error: '管理者権限が必要です' }, 403)
  }

  // 未実行の予約を取得（実行時刻が近い順）
  const reservations = await c.env.DB.prepare(`
    SELECT id, type, reserve_time, created_at
    FROM gold10_signal_reservations
    WHERE executed = 0
    ORDER BY reserve_time ASC
  `).all()

  return c.json({
    reservations: reservations.results || []
  })
})

// 予約サインを自動実行（Cron用 - モニターページから呼ばれる）
app.post('/api/admin/gold10/execute-reservations', async (c) => {
  const adminId = getCookie(c, 'admin_id')
  if (!adminId) {
    return c.json({ error: '管理者権限が必要です' }, 403)
  }

  const now = Math.floor(Date.now() / 1000)
  
  // 実行時刻を過ぎた未実行の予約を取得
  const dueReservations = await c.env.DB.prepare(`
    SELECT id, type, reserve_time
    FROM gold10_signal_reservations
    WHERE executed = 0 AND reserve_time <= ?
    ORDER BY reserve_time ASC
  `).bind(now).all()

  const executed = []
  
  for (const reservation of (dueReservations.results || [])) {
    try {
      // 最新のローソク足を取得
      const latestCandle = await c.env.DB.prepare(`
        SELECT * FROM gold10_candles
        ORDER BY timestamp DESC
        LIMIT 1
      `).first() as Candle | null

      if (!latestCandle) {
        continue
      }

      const rsi = latestCandle.rsi || 50
      const price = latestCandle.close
      
      // ターゲット価格を計算
      const targetPriceOffset = 4.5 + Math.random() * 1.0  // $4.5-$5.5
      const targetPrice = reservation.type === 'BUY' 
        ? price + targetPriceOffset 
        : price - targetPriceOffset

      // 勝率75%で成功フラグを設定
      const success = Math.random() < 0.75

      // サインをDBに保存
      await c.env.DB.prepare(`
        INSERT INTO gold10_signals (candle_id, timestamp, type, price, target_price, success, rsi)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        latestCandle.id,
        now,
        reservation.type,
        price,
        targetPrice,
        success ? 1 : 0,
        rsi
      ).run()

      // 予約を実行済みにマーク
      await c.env.DB.prepare(`
        UPDATE gold10_signal_reservations
        SET executed = 1, executed_at = ?
        WHERE id = ?
      `).bind(now, reservation.id).run()

      executed.push({
        id: reservation.id,
        type: reservation.type,
        price,
        targetPrice,
        success
      })
    } catch (error) {
      console.error('予約実行エラー:', error)
    }
  }

  return c.json({
    success: true,
    executed: executed.length,
    signals: executed
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

// オンラインユーザー数取得API
app.get('/api/users/online-count', async (c) => {
  // 過去5分以内にアクティビティがあったユーザーをオンラインとみなす
  const { results } = await c.env.DB.prepare(`
    SELECT COUNT(*) as online_count
    FROM users
    WHERE last_activity_at > datetime('now', '-5 minutes')
  `).all()

  const onlineCount = results && results[0] ? (results[0] as any).online_count : 0

  return c.json({ 
    online_count: onlineCount,
    timestamp: new Date().toISOString()
  })
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

  const { title, youtubeUrl, orderIndex, category } = await c.req.json()

  const result = await c.env.DB.prepare(`
    INSERT INTO videos (title, youtube_url, order_index, category) VALUES (?, ?, ?, ?)
  `).bind(title, youtubeUrl, orderIndex || 0, category || '環境設定').run()

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

  // 🎁 チャット送信で1ポイント付与
  await c.env.DB.prepare(`
    UPDATE users SET balance = balance + 1 WHERE id = ?
  `).bind(userId).run()

  return c.json({
    success: true,
    messageId: result.meta.last_row_id,
    pointsAwarded: 1,
    message: 'メッセージを送信しました。1ポイント獲得！'
  })
})

// チャットメッセージ削除（管理者のみ）
app.delete('/api/chat/messages/:id', async (c) => {
  const adminId = getCookie(c, 'admin_id')
  if (!adminId) {
    return c.json({ error: '管理者権限が必要です' }, 403)
  }

  const messageId = c.req.param('id')

  await c.env.DB.prepare(`
    DELETE FROM chat_messages WHERE id = ?
  `).bind(messageId).run()

  return c.json({ success: true })
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
    <!-- メンテナンス予告バナー -->
    <div class="fixed top-0 left-0 right-0 bg-gradient-to-r from-orange-600 to-red-600 text-white py-3 px-4 text-center shadow-lg z-50">
        <div class="container mx-auto flex items-center justify-center">
            <i class="fas fa-exclamation-triangle mr-2 text-xl"></i>
            <span class="font-bold text-sm sm:text-base">
                メンテナンスのお知らせ：日本時間 2月16日(月) 15:00までメンテナンス実施中
            </span>
        </div>
    </div>
    
    <div class="max-w-md w-full bg-white rounded-2xl shadow-2xl p-8 mt-16">
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
            
            <button 
                type="button"
                onclick="switchToRegister()"
                class="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 rounded-lg transition duration-200 flex items-center justify-center mt-3"
            >
                <i class="fas fa-user-plus mr-2"></i>
                新規登録
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
        let isRegisterMode = false;
        
        function switchToRegister() {
            isRegisterMode = !isRegisterMode;
            const form = document.getElementById('loginForm');
            const submitBtn = form.querySelector('button[type="submit"]');
            const toggleBtn = form.querySelector('button[type="button"]');
            
            if (isRegisterMode) {
                submitBtn.innerHTML = '<i class="fas fa-user-plus mr-2"></i>新規登録';
                submitBtn.className = 'w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 rounded-lg transition duration-200 flex items-center justify-center';
                toggleBtn.innerHTML = '<i class="fas fa-sign-in-alt mr-2"></i>ログインに戻る';
                toggleBtn.className = 'w-full bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-3 rounded-lg transition duration-200 flex items-center justify-center mt-3';
            } else {
                submitBtn.innerHTML = '<i class="fas fa-sign-in-alt mr-2"></i>ログイン';
                submitBtn.className = 'w-full bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-3 rounded-lg transition duration-200 flex items-center justify-center';
                toggleBtn.innerHTML = '<i class="fas fa-user-plus mr-2"></i>新規登録';
                toggleBtn.className = 'w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 rounded-lg transition duration-200 flex items-center justify-center mt-3';
            }
        }
        
        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const password = document.getElementById('password').value;

            try {
                const endpoint = isRegisterMode ? '/api/auth/register' : '/api/auth/login';
                const response = await axios.post(endpoint, { password });
                
                if (response.data.success) {
                    if (isRegisterMode && response.data.message) {
                        alert(response.data.message);
                    }
                    window.location.href = '/trade';
                }
            } catch (error) {
                const errorData = error.response?.data;
                if (errorData?.alreadyExists) {
                    // 重複エラーの場合、詳細メッセージを表示
                    alert('⚠️ ' + errorData.error + '\n\n別のパスワードをお試しください。');
                } else {
                    alert(errorData?.error || (isRegisterMode ? '登録に失敗しました' : 'ログインに失敗しました'));
                }
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
    <!-- メンテナンス予告バナー -->
    <div class="fixed top-0 left-0 right-0 bg-gradient-to-r from-orange-600 to-red-600 text-white py-3 px-4 text-center shadow-lg z-50">
        <div class="container mx-auto flex items-center justify-center">
            <i class="fas fa-exclamation-triangle mr-2 text-xl"></i>
            <span class="font-bold text-sm sm:text-base">
                メンテナンスのお知らせ：日本時間 2月16日(月) 15:00までメンテナンス実施中
            </span>
        </div>
    </div>
    
    <div class="max-w-md w-full bg-white rounded-2xl shadow-2xl p-8 mt-16">
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
app.get('/trade', async (c) => {
  // ユーザー情報を取得
  const userId = getCookie(c, 'user_id')
  let userPassword = null;
  
  if (userId) {
    const user = await c.env.DB.prepare(`
      SELECT password FROM users WHERE id = ?
    `).bind(userId).first()
    
    if (user) {
      userPassword = user.password
    }
  }
  
  // チャート表示の制御（全ユーザーに解放）
  const showChart = true;
  
  // メンテナンスモード
  const maintenanceMode = false; // チャート確認のため解除
  
  if (maintenanceMode) {
    return c.html(`
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>メンテナンス中 - GOLD LABO</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    <style>
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        .pulse-animation {
            animation: pulse 2s ease-in-out infinite;
        }
    </style>
</head>
<body class="bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 min-h-screen flex items-center justify-center">
    <div class="container mx-auto px-4">
        <div class="max-w-2xl mx-auto bg-white rounded-2xl shadow-2xl p-8 md:p-12 text-center">
            <!-- メンテナンスアイコン -->
            <div class="pulse-animation mb-8">
                <i class="fas fa-tools text-8xl text-yellow-500"></i>
            </div>
            
            <!-- タイトル -->
            <h1 class="text-4xl md:text-5xl font-bold text-gray-800 mb-6">
                メンテナンス中です
            </h1>
            
            <!-- メッセージ -->
            <div class="mb-8">
                <p class="text-xl text-gray-600 mb-4">
                    しばらくお待ちください。
                </p>
                <div class="bg-yellow-50 border-l-4 border-yellow-500 p-6 rounded-lg">
                    <p class="text-lg font-semibold text-gray-800 mb-2">
                        <i class="fas fa-clock mr-2 text-yellow-500"></i>
                        再開目安
                    </p>
                    <p class="text-3xl font-bold text-yellow-600">
                        23時頃
                    </p>
                </div>
            </div>
            
            <!-- 詳細メッセージ -->
            <div class="text-gray-600 text-sm space-y-2">
                <p>現在、システムの改善作業を行っております。</p>
                <p>ご不便をおかけして申し訳ございません。</p>
                <p class="text-gray-500 mt-4">
                    <i class="fas fa-info-circle mr-1"></i>
                    自動でページが更新されます
                </p>
            </div>
            
            <!-- 戻るボタン -->
            <div class="mt-8">
                <a href="/" class="inline-block bg-gradient-to-r from-yellow-600 to-yellow-500 text-white px-8 py-3 rounded-lg font-bold hover:from-yellow-700 hover:to-yellow-600 transition-all transform hover:scale-105">
                    <i class="fas fa-home mr-2"></i>
                    トップページに戻る
                </a>
            </div>
        </div>
    </div>
    
    <script>
        // 30秒ごとにページをリロード（メンテナンス終了後に自動で通常画面に戻る）
        setTimeout(() => {
            location.reload();
        }, 30000);
    </script>
</body>
</html>
    `);
  }
  
  return c.html(`
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GOLD LABO</title>
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
            height: 200px;  /* スマホ版: 300px → 200pxに縮小 */
            touch-action: pan-y pinch-zoom;
        }
        @media (min-width: 640px) {
            #chartContainer {
                height: 350px;  /* タブレット版: 400px → 350px */
            }
        }
        @media (min-width: 1024px) {
            #chartContainer {
                height: 600px;  /* PC版は変更なし */
            }
        }
        #rsiContainer {
            position: relative;
            width: 100%;
            height: 100px;
            margin-top: 10px;
        }
        @media (min-width: 640px) {
            #rsiContainer {
                height: 120px;
            }
        }
        @media (min-width: 1024px) {
            #rsiContainer {
                height: 150px;
            }
        }
    </style>
</head>
<body class="bg-gray-100 overflow-hidden">
    <!-- メンテナンス予告バナー -->
    <div class="bg-gradient-to-r from-orange-600 to-red-600 text-white py-3 px-4 text-center shadow-lg">
        <div class="container mx-auto flex items-center justify-center">
            <i class="fas fa-exclamation-triangle mr-2 text-xl"></i>
            <span class="font-bold text-sm sm:text-base">
                メンテナンスのお知らせ：日本時間 2月16日(月) 15:00までメンテナンス実施中
            </span>
        </div>
    </div>
    
    <!-- ヘッダー -->
    <header class="bg-gradient-to-r from-yellow-600 to-yellow-500 text-white p-3 sm:p-4 shadow-lg">
        <div class="container mx-auto flex justify-between items-center">
            <h1 class="text-lg sm:text-xl font-bold"><i class="fas fa-coins mr-1 sm:mr-2"></i>GOLD LABO</h1>
            <!-- PC用ナビゲーション -->
            <nav class="hidden md:flex space-x-4">
                <a href="/trade" class="hover:text-yellow-200"><i class="fas fa-chart-line mr-1"></i>トレード</a>
                <a href="/mypage" class="hover:text-yellow-200"><i class="fas fa-user mr-1"></i>マイページ</a>
                <a href="/signal-history" class="hover:text-yellow-200"><i class="fas fa-history mr-1"></i>サイン結果</a>
                <a href="/ranking" class="hover:text-yellow-200"><i class="fas fa-trophy mr-1"></i>ランキング</a>
                <a href="/videos" class="hover:text-yellow-200"><i class="fas fa-video mr-1"></i>動画教材</a>
                <a href="/chat" class="hover:text-yellow-200"><i class="fas fa-comments mr-1"></i>チャット</a>
                <button onclick="logout()" class="hover:text-yellow-200"><i class="fas fa-sign-out-alt mr-1"></i>ログアウト</button>
            </nav>
            <!-- スマホ用メニューボタン -->
            <button onclick="toggleMobileMenu()" class="md:hidden text-white">
                <i class="fas fa-bars text-xl"></i>
            </button>
        </div>
        <!-- スマホ用メニュー -->
        <div id="mobileMenu" class="hidden md:hidden mt-3 space-y-2">
            <a href="/trade" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-chart-line mr-2"></i>トレード</a>
            <a href="/mypage" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-user mr-2"></i>マイページ</a>
            <a href="/signal-history" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-history mr-2"></i>サイン結果</a>
            <a href="/ranking" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-trophy mr-2"></i>ランキング</a>
            <a href="/videos" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-video mr-2"></i>動画教材</a>
            <a href="/chat" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-comments mr-2"></i>チャット</a>
            <button onclick="logout()" class="block w-full text-left py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-sign-out-alt mr-2"></i>ログアウト</button>
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

    <!-- メインコンテンツ: レスポンシブレイアウト -->
    <div class="flex flex-col lg:flex-row h-[calc(100vh-72px)]">
        <!-- チャートエリア（PC: 左2/3、スマホ: 上半分） -->
        <div class="w-full lg:w-2/3 bg-white p-2 sm:p-4 flex flex-col border-b lg:border-b-0 lg:border-r border-gray-300 lg:overflow-y-auto">
            <div class="mb-2 sm:mb-4">
                <h2 class="text-lg sm:text-2xl font-bold text-gray-800 mb-1 sm:mb-2">
                    <i class="fas fa-chart-candlestick mr-1 sm:mr-2 text-yellow-600"></i>
                    GOLD10 練習チャート
                </h2>
                <p class="text-xs sm:text-sm text-gray-600">
                    <i class="fas fa-info-circle mr-1"></i>
                    30秒足ローソク足チャート（全ユーザー共通）
                </p>
            </div>
            
            <!-- 現在価格表示 -->
            <div class="bg-gradient-to-br from-yellow-100 to-yellow-50 rounded-lg shadow-md p-3 sm:p-4 mb-2 sm:mb-4">
                <div class="flex justify-between items-center">
                    <div>
                        <h3 class="text-xs sm:text-sm text-gray-600 mb-1">GOLD10 現在価格</h3>
                        <div id="gold10Price" class="text-2xl sm:text-4xl font-bold text-yellow-700">$0.00</div>
                        <div class="mt-1 text-xs text-gray-500">
                            <i class="fas fa-clock mr-1"></i>
                            次のローソク足まで <span id="nextCandleCountdown" class="font-bold text-blue-600">--</span>
                        </div>
                    </div>
                    <div class="text-right">
                        <div class="text-xs sm:text-sm text-gray-600">RSI (14)</div>
                        <div id="gold10RSI" class="text-xl sm:text-2xl font-bold text-blue-600">--</div>
                    </div>
                </div>
            </div>
            
            <!-- ローソク足チャート -->
            <div class="bg-white rounded-lg shadow-md p-2 sm:p-4 mb-2 sm:mb-4 flex-1 flex flex-col min-h-0 max-h-[350px] lg:max-h-none">
                <h3 class="text-sm sm:text-lg font-bold mb-2 text-gray-700">
                    <i class="fas fa-chart-line mr-1 sm:mr-2"></i>価格チャート
                </h3>
                ${showChart ? `
                <div style="position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column;">
                    <!-- ローソク足チャート（70%） -->
                    <div id="chartContainer" style="height: 70%; min-height: 200px;"></div>
                    <!-- MACDチャート（30%） -->
                    <div id="macdContainer" style="height: 30%; min-height: 100px; margin-top: 4px;"></div>
                    <!-- カスタムツールチップ -->
                    <div id="tooltip" style="
                        position: absolute;
                        display: none;
                        padding: 8px;
                        background: rgba(255, 255, 255, 0.95);
                        border: 1px solid #ccc;
                        border-radius: 4px;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                        pointer-events: none;
                        z-index: 1000;
                        font-size: 12px;
                        line-height: 1.5;
                    ">
                        <div id="tooltipContent"></div>
                    </div>
                </div>
                ` : `
                <div style="position: relative; flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; background: #f3f4f6;">
                    <div class="text-center p-8">
                        <i class="fas fa-lock text-6xl text-gray-400 mb-4"></i>
                        <p class="text-xl text-gray-600 font-semibold">チャートは現在準備中です</p>
                        <p class="text-sm text-gray-500 mt-2">まもなく公開予定</p>
                    </div>
                </div>
                `}
            </div>
        </div>

        <!-- 取引UIエリア（PC: 右1/3、スマホ: 下半分） -->
        <div class="w-full lg:w-1/3 bg-gray-50 p-2 sm:p-4 overflow-y-auto">
            <!-- 残高表示 -->
            <div class="bg-white rounded-lg shadow-md p-3 sm:p-4 mb-3 sm:mb-4">
                <div class="flex justify-between items-center mb-2">
                    <span class="text-gray-600 text-xs sm:text-sm">残高</span>
                    <span class="text-gray-600 text-xs sm:text-sm">総損益</span>
                </div>
                <div class="flex justify-between items-center">
                    <span id="balance" class="text-xl sm:text-2xl font-bold text-gray-800">¥0</span>
                    <span id="totalProfit" class="text-lg sm:text-xl font-bold">¥0</span>
                </div>
                <div class="text-center mt-2 hidden sm:block">
                    <p class="text-xs text-gray-500">
                        <i class="fas fa-info-circle mr-1"></i>
                        残高リセット希望者はサポートラインに問い合わせください
                    </p>
                </div>
            </div>

            <!-- 購入ロット数 -->
            <div class="bg-white rounded-lg shadow-md p-3 sm:p-4 mb-3 sm:mb-4">
                <label class="block text-gray-700 font-medium mb-2 sm:mb-3 text-sm sm:text-base">購入ロット数</label>
                
                <div class="text-center mb-2 sm:mb-4">
                    <div class="py-2 sm:py-3 bg-blue-100 rounded-lg border-2 border-blue-400">
                        <span class="text-base sm:text-lg font-bold text-blue-800">1 lot 固定</span>
                    </div>
                </div>
            </div>

            <!-- 売買ボタン -->
            <div class="grid grid-cols-2 gap-2 sm:gap-3 mb-3 sm:mb-4">
                <button onclick="openPosition('BUY')" class="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-bold py-3 sm:py-4 rounded-lg shadow-lg text-sm sm:text-base">
                    <i class="fas fa-arrow-up mr-1 sm:mr-2"></i>買う
                </button>
                <button onclick="openPosition('SELL')" class="bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white font-bold py-3 sm:py-4 rounded-lg shadow-lg text-sm sm:text-base">
                    <i class="fas fa-arrow-down mr-1 sm:mr-2"></i>売る
                </button>
            </div>

            <!-- オープンポジション表示 -->
            <div class="bg-white rounded-lg shadow-md p-3 sm:p-4 mb-3 sm:mb-4">
                <h3 class="text-base sm:text-lg font-bold mb-2 sm:mb-3 text-gray-700">
                    <i class="fas fa-list mr-2"></i>保有ポジション
                </h3>
                <div id="openPositions" class="space-y-3"></div>
            </div>

            <!-- オンラインチャット -->
            <div class="bg-white rounded-lg shadow-md mb-3 sm:mb-4">
                <button onclick="toggleChat()" class="w-full flex items-center justify-between p-3 sm:p-4 text-gray-700 hover:text-gray-900">
                    <div class="flex items-center">
                        <i class="fas fa-comments mr-2"></i>
                        <span class="text-sm sm:text-base">オンラインチャット</span>
                    </div>
                    <i id="chatToggleIcon" class="fas fa-chevron-down"></i>
                </button>
                
                <!-- チャットエリア -->
                <div id="chatArea" class="hidden border-t border-gray-200">
                    <div id="chatMessages" class="h-48 sm:h-64 overflow-y-auto p-3 sm:p-4 space-y-2 bg-gray-50">
                        <p class="text-center text-gray-500 text-xs sm:text-sm">読み込み中...</p>
                    </div>
                    <div class="p-3 sm:p-4 bg-white border-t border-gray-200">
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

            <!-- AIフィードバック -->
            <div class="bg-gradient-to-r from-purple-50 to-blue-50 border-l-4 border-purple-500 p-4 rounded-lg shadow">
                <div class="flex items-start mb-3">
                    <i class="fas fa-robot text-purple-500 text-xl mr-3 mt-1"></i>
                    <div class="flex-1">
                        <h3 class="font-bold text-purple-800 mb-1">AIフィードバック</h3>
                        <p class="text-xs text-purple-600">あなたの取引履歴を分析して改善案を提案します</p>
                    </div>
                    <button 
                        onclick="getAIFeedback()" 
                        id="aiFeedbackBtn"
                        class="bg-purple-500 hover:bg-purple-600 text-white px-3 py-1 rounded-lg text-xs font-bold transition"
                    >
                        <i class="fas fa-sync-alt mr-1"></i>分析
                    </button>
                </div>
                <div id="aiFeedbackContent" class="text-sm text-purple-700 bg-white bg-opacity-60 rounded p-3 min-h-[60px]">
                    <p class="text-gray-500 italic">「分析」ボタンを押すと、AIがあなたの取引パターンを分析します。</p>
                </div>
            </div>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
    <script>
        // ========== GOLD10チャート関連 ==========
        let chart = null;
        let macdChart = null;
        let candlestickSeries = null;
        let macdLineSeries = null;
        let macdSignalSeries = null;
        let macdHistogramSeries = null;
        let signalMarkers = [];
        let candlesDataWithRSI = [];  // RSIデータを含むローソク足データを保持
        let lastCandleTimestamp = 0;  // 最後に追加したローソク足のタイムスタンプ
        let isChartInitialized = false;  // チャート初期化フラグ
        
        // MACD計算関数
        function calculateMACD(candles, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
            const closes = candles.map(c => c.close);
            
            // EMA計算
            function calculateEMA(data, period) {
                const k = 2 / (period + 1);
                const emaArray = [data[0]];
                
                for (let i = 1; i < data.length; i++) {
                    const ema = (data[i] * k) + (emaArray[i - 1] * (1 - k));
                    emaArray.push(ema);
                }
                
                return emaArray;
            }
            
            // Fast EMA (12) と Slow EMA (26)
            const fastEMA = calculateEMA(closes, fastPeriod);
            const slowEMA = calculateEMA(closes, slowPeriod);
            
            // MACD Line = Fast EMA - Slow EMA
            const macdLine = fastEMA.map((fast, i) => fast - slowEMA[i]);
            
            // Signal Line = MACD LineのEMA(9)
            const signalLine = calculateEMA(macdLine, signalPeriod);
            
            // Histogram = MACD Line - Signal Line
            const histogram = macdLine.map((macd, i) => macd - signalLine[i]);
            
            return candles.map((candle, i) => ({
                time: candle.timestamp,
                macd: macdLine[i],
                signal: signalLine[i],
                histogram: histogram[i]
            }));
        }
        
        // Lightweight Chartsの初期化
        function initializeCharts() {
            // メインチャート（ローソク足）
            const chartContainer = document.getElementById('chartContainer');
            const macdContainer = document.getElementById('macdContainer');
            const isMobile = window.innerWidth < 1024;
            
            const chartOptions = {
                width: chartContainer.clientWidth,
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
                rightPriceScale: {
                    scaleMargins: {
                        top: 0.1,    // 上部10%のマージン
                        bottom: 0.1, // 下部10%のマージン
                    },
                    borderVisible: false,
                },
                timeScale: {
                    timeVisible: false,
                    secondsVisible: false,
                    rightOffset: 3,
                    barSpacing: 6,
                    fixLeftEdge: false,
                    fixRightEdge: false,
                    lockVisibleTimeRangeOnResize: false,
                    rightBarStaysOnScroll: true,
                    visible: false,
                },
                localization: {
                    timeFormatter: (timestamp) => {
                        const date = new Date(timestamp * 1000);
                        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
                        const day = String(date.getUTCDate()).padStart(2, '0');
                        const hours = String(date.getUTCHours()).padStart(2, '0');
                        const minutes = String(date.getUTCMinutes()).padStart(2, '0');
                        return month + '/' + day + ' ' + hours + ':' + minutes;
                    },
                },
            };
            
            // ローソク足チャート
            chart = LightweightCharts.createChart(chartContainer, {
                ...chartOptions,
                height: chartContainer.clientHeight,
            });

            candlestickSeries = chart.addCandlestickSeries({
                upColor: '#26a69a',
                downColor: '#ef5350',
                borderVisible: false,
                wickUpColor: '#26a69a',
                wickDownColor: '#ef5350',
            });
            
            // MACDチャート
            macdChart = LightweightCharts.createChart(macdContainer, {
                ...chartOptions,
                height: macdContainer.clientHeight,
            });
            
            // MACD Line (青)
            macdLineSeries = macdChart.addLineSeries({
                color: '#2196F3',
                lineWidth: 2,
                title: 'MACD',
            });
            
            // Signal Line (赤)
            macdSignalSeries = macdChart.addLineSeries({
                color: '#FF5252',
                lineWidth: 2,
                title: 'Signal',
            });
            
            // Histogram (ヒストグラム)
            macdHistogramSeries = macdChart.addHistogramSeries({
                color: '#26a69a',
                priceFormat: {
                    type: 'volume',
                },
                priceScaleId: '',
            });

            // 両チャートのクロスヘアを同期
            chart.subscribeCrosshairMove((param) => {
                if (param.time) {
                    macdChart.timeScale().scrollToPosition(0, false);
                }
            });
            
            macdChart.subscribeCrosshairMove((param) => {
                if (param.time) {
                    chart.timeScale().scrollToPosition(0, false);
                }
            });
            
            // タイムスケールの同期
            chart.timeScale().subscribeVisibleLogicalRangeChange((timeRange) => {
                macdChart.timeScale().setVisibleLogicalRange(timeRange);
            });
            
            macdChart.timeScale().subscribeVisibleLogicalRangeChange((timeRange) => {
                chart.timeScale().setVisibleLogicalRange(timeRange);
            });

            // ウィンドウリサイズ対応
            window.addEventListener('resize', () => {
                const chartContainer = document.getElementById('chartContainer');
                const macdContainer = document.getElementById('macdContainer');
                
                chart.applyOptions({ 
                    width: chartContainer.clientWidth,
                    height: chartContainer.clientHeight
                });
                
                macdChart.applyOptions({ 
                    width: macdContainer.clientWidth,
                    height: macdContainer.clientHeight
                });
            });

            // カスタムツールチップ（RSIのみ表示）
            const tooltip = document.getElementById('tooltip');
            const tooltipContent = document.getElementById('tooltipContent');

            chart.subscribeCrosshairMove((param) => {
                if (!param.time || !param.point) {
                    tooltip.style.display = 'none';
                    return;
                }

                // 該当時刻のローソク足データを探す
                const candleData = candlesDataWithRSI.find(c => c.timestamp === param.time);
                if (!candleData) {
                    tooltip.style.display = 'none';
                    return;
                }

                // RSI値を取得
                const rsi = candleData.rsi ? candleData.rsi.toFixed(1) : '--';
                
                // RSI色分け
                let rsiColor = '#3b82f6';  // blue
                if (candleData.rsi >= 70) {
                    rsiColor = '#ef4444';  // red
                } else if (candleData.rsi <= 30) {
                    rsiColor = '#22c55e';  // green
                }

                // ツールチップの内容を設定（RSIのみ表示）
                tooltipContent.innerHTML = \`
                    <div style="color: \${rsiColor}; font-weight: bold;">RSI: \${rsi}</div>
                \`;

                // ツールチップの位置を設定
                const chartContainer = document.getElementById('chartContainer');
                const chartRect = chartContainer.getBoundingClientRect();
                
                tooltip.style.display = 'block';
                tooltip.style.left = param.point.x + 'px';
                tooltip.style.top = (param.point.y - 40) + 'px';  // 少し上に表示
            });
        }

        // GOLD10データを読み込んでチャートに表示（初回のみsetData使用）
        async function loadGold10Chart() {
            try {
                // 過去12時間分のローソク足データを取得
                const candlesResponse = await axios.get('/api/gold10/candles?hours=12');
                const candles = candlesResponse.data;

                // RSIデータを含むローソク足データを保存
                candlesDataWithRSI = candles;

                // 【サイン表示を無効化】サインデータ取得をコメントアウト
                // const signalsResponse = await axios.get('/api/gold10/signals?hours=12');
                // const signals = signalsResponse.data;
                const signals = []; // 空配列に設定してサイン表示を完全無効化

                // ローソク足データをLightweight Charts形式に変換
                const candleData = candles.map(c => ({
                    time: c.timestamp,
                    open: c.open,
                    high: c.high,
                    low: c.low,
                    close: c.close
                }));

                // 【Lightweight Charts 固定モード】
                // チャート初期化：setData()は初回のみ1回だけ実行
                if (candleData.length > 0 && !isChartInitialized) {
                    candlestickSeries.setData(candleData);
                    isChartInitialized = true;
                    lastCandleTimestamp = candleData[candleData.length - 1].time;
                    
                    // MACDデータを計算して表示
                    const macdData = calculateMACD(candles);
                    
                    const macdLineData = macdData.map(d => ({ time: d.time, value: d.macd }));
                    const signalLineData = macdData.map(d => ({ time: d.time, value: d.signal }));
                    const histogramData = macdData.map(d => ({ 
                        time: d.time, 
                        value: d.histogram,
                        color: d.histogram >= 0 ? '#26a69a' : '#ef5350'
                    }));
                    
                    macdLineSeries.setData(macdLineData);
                    macdSignalSeries.setData(signalLineData);
                    macdHistogramSeries.setData(histogramData);
                    
                    // チャートの表示範囲を最新データに合わせる
                    const latestTime = candleData[candleData.length - 1].time;
                    const earliestTime = candleData[Math.max(0, candleData.length - 100)].time; // 最新100本を表示
                    chart.timeScale().setVisibleRange({
                        from: earliestTime,
                        to: latestTime
                    });
                    
                    // MACDチャートも同じ範囲に
                    macdChart.timeScale().setVisibleRange({
                        from: earliestTime,
                        to: latestTime
                    });
                    
                    // 価格軸を表示データの範囲に合わせて調整
                    // autoScaleとfitContentで自動調整（実際のローソク足の価格範囲に合わせる）
                    chart.priceScale('right').applyOptions({ 
                        autoScale: true,
                        scaleMargins: {
                            top: 0.1,    // 上部10%のマージン
                            bottom: 0.1, // 下部10%のマージン
                        },
                    });
                    
                    // 時間軸をデータに合わせる
                    chart.timeScale().fitContent();
                    
                    // MACDチャートも同様に調整
                    macdChart.priceScale('right').applyOptions({ 
                        autoScale: true,
                        scaleMargins: {
                            top: 0.2,
                            bottom: 0.2,
                        },
                    });
                    macdChart.timeScale().fitContent();
                    
                    // 最新価格とRSIを表示
                    const latestCandle = candles[candles.length - 1];
                    if (latestCandle) {
                        currentPrice = latestCandle.close;  // currentPriceを更新
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

                // 【サイン表示を無効化】
                // フロントエンド自動生成モードでは、サインはDBに保存されないため
                // 初期ロード時のサインマーカー表示も無効化します
                /*
                // サインをマーカーとして表示（表示範囲内のみ）
                if (signals.length > 0 && candleData.length > 0) {
                    // 🔒 表示範囲の開始時刻を取得（最新100本）
                    const displayStartTime = candleData[Math.max(0, candleData.length - 100)].time;
                    
                    // 表示範囲内のサインのみフィルタリング（左端にサインが溜まらないように）
                    const visibleSignals = signals.filter(signal => signal.timestamp >= displayStartTime);
                    
                    const markers = visibleSignals.map(signal => ({
                        time: signal.timestamp,
                        position: signal.type === 'BUY' ? 'belowBar' : 'aboveBar',
                        color: signal.type === 'BUY' ? '#26a69a' : '#ef5350',
                        shape: signal.type === 'BUY' ? 'arrowUp' : 'arrowDown',
                        text: signal.type === 'BUY' ? '買サイン' : '売サイン',
                    }));
                    candlestickSeries.setMarkers(markers);
                    signalMarkers = markers;
                }
                */

            } catch (error) {
                console.error('チャートデータ取得エラー:', error);
            }
        }

        // サインアラート用の変数
        let lastSignalTimestamp = 0;
        let lastSignalCount = 0;
        
        // サインアラートを表示
        function showSignalAlert(signal) {
            const notification = document.getElementById('notification');
            const icon = document.getElementById('notificationIcon');
            const titleEl = document.getElementById('notificationTitle');
            const messageEl = document.getElementById('notificationMessage');
            const container = notification.querySelector('div');

            // サインタイプに応じてスタイル変更
            if (signal.type === 'BUY') {
                container.className = 'bg-white rounded-lg shadow-2xl p-6 min-w-[300px] border-4 border-green-500';
                icon.className = 'fas fa-arrow-up text-5xl mr-4 text-green-500';
                titleEl.textContent = '🔔 買いサイン点灯！';
                messageEl.textContent = '$' + signal.price.toFixed(2) + ' で買いサインが出ました';
            } else {
                container.className = 'bg-white rounded-lg shadow-2xl p-6 min-w-[300px] border-4 border-red-500';
                icon.className = 'fas fa-arrow-down text-5xl mr-4 text-red-500';
                titleEl.textContent = '🔔 売りサイン点灯！';
                messageEl.textContent = '$' + signal.price.toFixed(2) + ' で売りサインが出ました';
            }

            notification.classList.remove('hidden');
            notification.classList.add('notification-enter');

            // 音を鳴らす（オプション）
            try {
                const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuHzPLaizsIHGm98OScTgwOUKnh77RgGgU7k9r0yXksBSOAyfLajTkIHWq87+SbTQwOUKrg77RhGwc9lNz0yHcqBSJ+yPLakTUIHW296eSYTQwMUKvm8LVjHAY7k9r0yXksAyJ+yPLajjkIHW+98OScTQwMU');
                audio.volume = 0.3;
                audio.play().catch(() => {});
            } catch (e) {
                // 音再生エラーは無視
            }

            setTimeout(() => {
                notification.classList.remove('notification-enter');
                notification.classList.add('notification-exit');
                setTimeout(() => {
                    notification.classList.add('hidden');
                    notification.classList.remove('notification-exit');
                }, 300);
            }, 5000); // 5秒間表示
        }
        
        // 次回サイン予定時刻を計算・表示
        // 【サイン機能完全無効化】次回サイン予定時刻の更新を無効化
        /*
        async function updateNextSignalTime() {
            try {
                const response = await axios.get('/api/gold10/signals?hours=12');
                const signals = response.data;
                
                if (signals.length === 0) {
                    document.getElementById('nextSignalTime').textContent = '不明';
                    document.getElementById('timeUntilSignal').textContent = '--';
                    return;
                }
                
                // 最新のサインのタイムスタンプ
                const latestSignal = signals[signals.length - 1];
                const latestTime = latestSignal.timestamp * 1000; // ミリ秒に変換
                
                // 次回サイン予定時刻（25-35分後の中央値=30分後）
                const nextSignalTime = latestTime + (30 * 60 * 1000);
                const nextDate = new Date(nextSignalTime);
                
                // UTC時刻で表示
                const hours = String(nextDate.getUTCHours()).padStart(2, '0');
                const minutes = String(nextDate.getUTCMinutes()).padStart(2, '0');
                document.getElementById('nextSignalTime').textContent = hours + ':' + minutes + ' UTC';
                
                // 残り時間を計算
                const now = Date.now();
                const timeLeft = nextSignalTime - now;
                
                if (timeLeft < 0) {
                    document.getElementById('timeUntilSignal').textContent = 'まもなく';
                } else {
                    const minutesLeft = Math.floor(timeLeft / (60 * 1000));
                    const secondsLeft = Math.floor((timeLeft % (60 * 1000)) / 1000);
                    document.getElementById('timeUntilSignal').textContent = 
                        minutesLeft + '分' + secondsLeft + '秒';
                }
            } catch (error) {
                console.error('次回サイン時刻計算エラー:', error);
            }
        }
        */
        // サイン機能を無効化したため、ダミー関数を定義
        async function updateNextSignalTime() {
            // 何もしない
        }

        // 【Lightweight Charts 固定モード】
        // チャートをリアルタイム更新：update()のみ使用、setData()禁止
        async function updateGold10Chart() {
            try {
                // 最新のローソク足データを取得（最後の2本）
                const response = await axios.get('/api/gold10/candles?limit=2');
                const candles = response.data;

                if (candles && candles.length > 0) {
                    // タイムスタンプでソート（古い順）
                    candles.sort((a, b) => a.timestamp - b.timestamp);
                    
                    // 各ローソク足を update() で追加/更新
                    for (const candle of candles) {
                        // 【重要】新しい足を追加する前に Next_Open = Previous_Close を強制
                        if (candle.timestamp > lastCandleTimestamp) {
                            // 新しい足の場合、前の足のCloseを取得
                            const prevCandle = candlesDataWithRSI[candlesDataWithRSI.length - 1];
                            if (prevCandle && Math.abs(candle.open - prevCandle.close) > 0.000001) {
                                // Openを強制的に前足のCloseに修正
                                candle.open = prevCandle.close;
                                console.log('[固定モード] Next_Open = Previous_Close を強制: $' + candle.open.toFixed(2));
                            }
                            lastCandleTimestamp = candle.timestamp;
                        }
                        
                        // update()でローソク足を追加/更新
                        candlestickSeries.update({
                            time: candle.timestamp,
                            open: candle.open,
                            high: candle.high,
                            low: candle.low,
                            close: candle.close
                        });

                        // RSIデータを含むローソク足データを更新
                        const existingIndex = candlesDataWithRSI.findIndex(c => c.timestamp === candle.timestamp);
                        if (existingIndex >= 0) {
                            candlesDataWithRSI[existingIndex] = candle;
                        } else {
                            candlesDataWithRSI.push(candle);
                        }
                    }
                    
                    // 最新のローソク足を取得
                    const latestCandle = candles[candles.length - 1];
                    
                    // MACDデータを再計算して update() で更新
                    const macdData = calculateMACD(candlesDataWithRSI);
                    const latestMACD = macdData[macdData.length - 1];
                    
                    if (latestMACD) {
                        macdLineSeries.update({ time: latestMACD.time, value: latestMACD.macd });
                        macdSignalSeries.update({ time: latestMACD.time, value: latestMACD.signal });
                        macdHistogramSeries.update({ 
                            time: latestMACD.time, 
                            value: latestMACD.histogram,
                            color: latestMACD.histogram >= 0 ? '#26a69a' : '#ef5350'
                        });
                    }

                    // 現在価格とRSI表示を更新
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
                    
                    // currentPriceもGOLD10価格に更新
                    currentPrice = latestCandle.close;
                }
                
                // 【サイン表示を無効化】
                // フロントエンド自動生成モードでは、サインはDBに保存されないため
                // サインマーカーの表示を一時的に無効化します
                // 
                // サインマーカーの更新（コメントアウト）
                /*
                const signalsResponse = await axios.get('/api/gold10/signals?hours=12');
                const signals = signalsResponse.data;

                // サインマーカーの更新（update()で追加）
                if (signals && signals.length > 0) {
                    // 🔒 すべてのサインを保持（削除しない）
                    
                    // 既存のマーカーと新しいマーカーをマージ（重複を避ける）
                    const existingTimestamps = new Set(signalMarkers.map(m => m.time));
                    const newMarkers = signals
                        .filter(signal => !existingTimestamps.has(signal.timestamp))
                        .filter(signal => !existingTimestamps.has(signal.timestamp))
                        .map(signal => ({
                            time: signal.timestamp,
                            position: signal.type === 'BUY' ? 'belowBar' : 'aboveBar',
                            color: signal.type === 'BUY' ? '#26a69a' : '#ef5350',
                            shape: signal.type === 'BUY' ? 'arrowUp' : 'arrowDown',
                            text: signal.type === 'BUY' ? '買サイン' : '売サイン',
                        }));
                    
                    // 新しいマーカーがあれば追加＆アラート表示
                    if (newMarkers.length > 0) {
                        signalMarkers = [...signalMarkers, ...newMarkers];
                        // タイムスタンプ順にソート
                        signalMarkers.sort((a, b) => a.time - b.time);
                        candlestickSeries.setMarkers(signalMarkers);
                        
                        // 最新のサインでアラート表示（初回ロード時は表示しない）
                        if (lastSignalCount > 0) {
                            // 🔒 修正: タイムスタンプが最大のマーカーを取得
                            const latestNewMarker = newMarkers.reduce((latest, marker) => 
                                marker.time > latest.time ? marker : latest
                            , newMarkers[0]);
                            
                            // タイムスタンプで一致するサインを検索
                            const latestSignal = signals.find(s => s.timestamp === latestNewMarker.time);
                            
                            // デバッグログ（詳細）
                            console.log('新しいサイン検出:', {
                                newMarkersCount: newMarkers.length,
                                allNewMarkers: newMarkers.map(m => ({ time: m.time, text: m.text })),
                                latestNewMarker: { time: latestNewMarker.time, text: latestNewMarker.text },
                                latestSignal: latestSignal,
                                signalType: latestSignal?.type,
                                allSignals: signals.map(s => ({ timestamp: s.timestamp, type: s.type }))
                            });
                            
                            if (latestSignal) {
                                showSignalAlert(latestSignal);
                            } else {
                                console.error('サインが見つかりません:', latestNewMarker);
                            }
                        }
                        lastSignalCount = signals.length;
                        
                        // 次回サイン予定時刻を更新
                        updateNextSignalTime();
                    } else {
                        // 新しいサインはないが、古いサインを削除した場合はマーカーを更新
                        candlestickSeries.setMarkers(signalMarkers);
                    }
                }
                */

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
                document.getElementById('balance').textContent = '¥' + Math.round(user.balance).toLocaleString('ja-JP');
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
                // 1ロット = 100オンス
                const pl = pos.type === 'BUY' 
                    ? (currentPrice - pos.entry_price) * pos.amount * 100 * 152.96
                    : (pos.entry_price - currentPrice) * pos.amount * 100 * 152.96;
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
            // ポジション数制限チェック
            if (openPositions.length >= 3) {
                alert('最大ポジション数（3つ）に達しています。既存のポジションを決済してください。');
                return;
            }

            const amount = 1; // 1ロット固定

            try {
                // 現在価格をコンソールに出力
                console.log('[Trade] エントリー時の価格:', {
                    currentPrice: currentPrice,
                    timestamp: new Date().toISOString()
                });
                
                // 現在価格をサーバーに送信
                const response = await axios.post('/api/trade/open', { 
                    type, 
                    amount,
                    price: currentPrice  // フロントエンドの表示価格を送信
                });
                
                console.log('[Trade] サーバーレスポンス:', response.data);
                
                await loadOpenPositions();
                await loadUserData();
                
                const typeName = type === 'BUY' ? '買い' : '売り';
                showNotification('entry', 'エントリーしました！', \`\${typeName}ポジション \${amount} lot を開きました\`);
            } catch (error) {
                console.error('[Trade] エントリーエラー:', error);
                alert('エラー: ' + (error.response?.data?.error || '取引に失敗しました'));
            }
        }

        async function closePosition(tradeId) {
            try {
                // 現在価格をサーバーに送信
                const response = await axios.post(\`/api/trade/close/\${tradeId}\`, {
                    price: currentPrice  // フロントエンドの表示価格を送信
                });
                const profitLoss = response.data.profitLoss;
                
                await loadOpenPositions();
                await loadUserData();
                
                if (profitLoss >= 0) {
                    showNotification('profit', '利確しました！', \`+¥\${Math.round(profitLoss).toLocaleString('ja-JP')}\`);
                } else {
                    showNotification('loss', '損切りしました', \`¥\${Math.round(profitLoss).toLocaleString('ja-JP')}\`);
                }
            } catch (error) {
                alert('決済に失敗しました');
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
                const response = await axios.post('/api/chat/messages', { message });
                input.value = '';
                await loadChatMessages();
                
                // 🎁 ポイント獲得通知
                if (response.data.pointsAwarded) {
                    // 残高を更新
                    await loadUserData();
                    
                    // 通知を表示（既存の通知システムを使用）
                    const notification = document.getElementById('notification');
                    const icon = document.getElementById('notificationIcon');
                    const titleEl = document.getElementById('notificationTitle');
                    const messageEl = document.getElementById('notificationMessage');
                    const container = notification.querySelector('div');
                    
                    container.className = 'bg-white rounded-lg shadow-2xl p-6 min-w-[300px] border-4 border-yellow-500';
                    icon.className = 'fas fa-star text-5xl mr-4 text-yellow-500';
                    titleEl.textContent = '🎁 ポイント獲得！';
                    messageEl.textContent = 'チャットメッセージ送信で1ポイント獲得しました！';
                    
                    notification.classList.remove('hidden');
                    notification.classList.add('notification-enter');
                    
                    setTimeout(() => {
                        notification.classList.remove('notification-enter');
                        notification.classList.add('notification-exit');
                        setTimeout(() => {
                            notification.classList.add('hidden');
                            notification.classList.remove('notification-exit');
                        }, 300);
                    }, 3000); // 3秒間表示
                }
            } catch (error) {
                alert('メッセージ送信に失敗しました');
            }
        });

        // AIフィードバック取得
        async function getAIFeedback() {
            const btn = document.getElementById('aiFeedbackBtn');
            const content = document.getElementById('aiFeedbackContent');
            
            // ボタンを無効化してローディング表示
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>分析中...';
            content.innerHTML = '<p class="text-gray-500 italic flex items-center"><i class="fas fa-spinner fa-spin mr-2"></i>AIが取引履歴を分析しています...</p>';
            
            try {
                const response = await axios.get('/api/trade/ai-feedback');
                const data = response.data;
                const feedback = data.feedback;
                const stats = data.stats;
                
                // フィードバックを表示
                let statsHtml = '';
                if (stats) {
                    const profitClass = stats.totalProfit >= 0 ? 'text-green-600' : 'text-red-600';
                    const profitSign = stats.totalProfit >= 0 ? '+' : '';
                    const profitAmount = Math.round(stats.totalProfit).toLocaleString();
                    
                    statsHtml = '<div class="mb-2 pb-2 border-b border-purple-200 text-xs">' +
                        '<span class="font-bold">📊 ' + stats.totalTrades + '回</span> | ' +
                        '<span class="font-bold text-green-600">勝率 ' + stats.winRate + '%</span> | ' +
                        '<span class="font-bold ' + profitClass + '">' + profitSign + '¥' + profitAmount + '</span>' +
                        '</div>';
                }
                
                content.innerHTML = statsHtml + '<p class="whitespace-pre-wrap">' + feedback + '</p>';
                
                // ボタンを元に戻す
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-sync-alt mr-1"></i>再分析';
                
            } catch (error) {
                console.error('AIフィードバック取得エラー:', error);
                content.innerHTML = '<p class="text-red-600">エラーが発生しました。もう一度お試しください。</p>';
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-sync-alt mr-1"></i>分析';
            }
        }

        function toggleMobileMenu() {
            const menu = document.getElementById('mobileMenu');
            if (menu.classList.contains('hidden')) {
                menu.classList.remove('hidden');
            } else {
                menu.classList.add('hidden');
            }
        }

        async function logout() {
            await axios.post('/api/auth/logout');
            window.location.href = '/';
        }

        // 初期化
        (async () => {
            await loadUserData();
            // GOLD10チャートを初期化（パスワード 073111q のみ）
            const showChart = ${showChart};
            if (showChart) {
                initializeCharts();
                await loadGold10Chart();
            }
            // 初期価格を取得
            await updateGoldPrice();
            // ポジション表示（currentPriceが更新された後）
            await loadOpenPositions();
            
            // PC版のみ: チャートエリアを最下部にスクロール
            if (showChart && window.innerWidth >= 1024) {
                const chartArea = document.querySelector('.lg\\:overflow-y-auto');
                if (chartArea) {
                    setTimeout(() => {
                        chartArea.scrollTop = chartArea.scrollHeight;
                    }, 500); // チャート描画完了を待つ
                }
            }
        })();
        
        // ========================================
        // 【サーバー同期モード】
        // ========================================
        // 目的：全ユーザーが同じチャートを見る
        // サーバー側のDurable Objectが30秒ごとにローソク足を生成
        // クライアント側は5秒ごとにポーリングして最新データを取得
        // ========================================
        
        const showChart = ${showChart};
        
        if (showChart && !window.__pollingStarted) {
            console.log('[Genspark] 🚀 サーバー同期モード起動中...');
            
            window.__pollingStarted = true;
            window.__lastCandleTime = 0;
            
            // No need to start Durable Object - server generates on demand
            console.log('[Genspark] ✅ サーバー同期モード起動 - サーバーが自動生成');
            
            // Poll server every 5 seconds for latest data
            window.__pollingInterval = setInterval(async () => {
                try {
                    const response = await axios.get('/api/gold10/candles/latest?limit=100');
                    const data = response.data;
                    
                    // Update countdown
                    const countdownEl = document.getElementById('nextCandleCountdown');
                    if (countdownEl) {
                        const secondsLeft = data.secondsUntilNext;
                        countdownEl.textContent = secondsLeft + '秒';
                        if (secondsLeft <= 10) {
                            countdownEl.className = 'font-bold text-red-600 animate-pulse';
                        } else {
                            countdownEl.className = 'font-bold text-blue-600';
                        }
                    }
                    
                    // Check for new candles
                    if (data.candles && data.candles.length > 0) {
                        const latestCandle = data.candles[data.candles.length - 1];
                        
                        // If this is a new candle, update the chart
                        if (latestCandle.timestamp > window.__lastCandleTime) {
                            console.log('[Genspark] 🆕 新しいローソク足検出:', {
                                time: new Date(latestCandle.timestamp * 1000).toISOString(),
                                close: latestCandle.close.toFixed(2),
                                rsi: latestCandle.rsi ? latestCandle.rsi.toFixed(1) : 'N/A'
                            });
                            
                            // Update chart with new candle
                            if (candlestickSeries) {
                                candlestickSeries.update({
                                    time: latestCandle.timestamp,
                                    open: latestCandle.open,
                                    high: latestCandle.high,
                                    low: latestCandle.low,
                                    close: latestCandle.close
                                });
                            }
                            
                            // Update RSI display
                            if (latestCandle.rsi) {
                                const rsiElement = document.getElementById('gold10RSI');
                                if (rsiElement) {
                                    rsiElement.textContent = latestCandle.rsi.toFixed(1);
                                    if (latestCandle.rsi >= 70) {
                                        rsiElement.style.color = '#ef5350';
                                    } else if (latestCandle.rsi <= 30) {
                                        rsiElement.style.color = '#26a69a';
                                    } else {
                                        rsiElement.style.color = '#2962FF';
                                    }
                                }
                            }
                            
                            // Update price display
                            const priceElement = document.getElementById('gold10Price');
                            if (priceElement) {
                                priceElement.textContent = '$' + latestCandle.close.toFixed(2);
                            }
                            
                            // Update currentPrice for trading
                            currentPrice = latestCandle.close;
                            
                            window.__lastCandleTime = latestCandle.timestamp;
                        }
                    }
                    
                } catch (error) {
                    console.error('[Genspark] ❌ ポーリングエラー:', error);
                }
            }, 5000);  // 5秒ごと
            
            console.log('[Genspark] ✅ サーバー同期モード起動完了！');
        }

        // GOLD10価格と損益を10秒ごとに更新（ローソク足の途中経過を表示）
        setInterval(async () => {
            // 最新のGOLD10価格を取得して表示を更新
            await updateGoldPrice();
            
            // チャートも更新（ローソク足の途中経過を反映）
            if (showChart) await updateGold10Chart();
            
            // 15分経過ポジションの自動決済チェック
            try {
                const autoCloseResponse = await axios.post('/api/trade/auto-close-expired');
                if (autoCloseResponse.data.closedCount > 0) {
                    const closedCount = autoCloseResponse.data.closedCount;
                    const totalProfit = Math.round(autoCloseResponse.data.totalProfit).toLocaleString('ja-JP');
                    showNotification('info', '自動決済', closedCount + '件のポジションが15分経過により自動決済されました（損益: ¥' + totalProfit + '）');
                    // ユーザーデータと保有ポジションを再読み込み
                    await loadUserData();
                    await loadOpenPositions();
                }
            } catch (error) {
                console.error('自動決済チェックエラー:', error);
            }
            
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
    <!-- メンテナンス予告バナー -->
    <div class="bg-gradient-to-r from-orange-600 to-red-600 text-white py-3 px-4 text-center shadow-lg">
        <div class="container mx-auto flex items-center justify-center">
            <i class="fas fa-exclamation-triangle mr-2 text-xl"></i>
            <span class="font-bold text-sm sm:text-base">
                メンテナンスのお知らせ：日本時間 2月16日(月) 15:00までメンテナンス実施中
            </span>
        </div>
    </div>
    
    <header class="bg-gradient-to-r from-yellow-600 to-yellow-500 text-white p-3 sm:p-4 shadow-lg">
        <div class="container mx-auto flex justify-between items-center">
            <h1 class="text-lg sm:text-xl font-bold"><i class="fas fa-user mr-1 sm:mr-2"></i>マイページ</h1>
            <!-- PC用ナビゲーション -->
            <nav class="hidden md:flex space-x-4">
                <a href="/trade" class="hover:text-yellow-200"><i class="fas fa-chart-line mr-1"></i>トレード</a>
                <a href="/mypage" class="hover:text-yellow-200"><i class="fas fa-user mr-1"></i>マイページ</a>
                <a href="/signal-history" class="hover:text-yellow-200"><i class="fas fa-history mr-1"></i>サイン結果</a>
                <a href="/ranking" class="hover:text-yellow-200"><i class="fas fa-trophy mr-1"></i>ランキング</a>
                <a href="/videos" class="hover:text-yellow-200"><i class="fas fa-video mr-1"></i>動画教材</a>
                <a href="/chat" class="hover:text-yellow-200"><i class="fas fa-comments mr-1"></i>チャット</a>
                <button onclick="logout()" class="hover:text-yellow-200"><i class="fas fa-sign-out-alt mr-1"></i>ログアウト</button>
            </nav>
            <!-- スマホ用メニューボタン -->
            <button onclick="toggleMobileMenu()" class="md:hidden text-white">
                <i class="fas fa-bars text-xl"></i>
            </button>
        </div>
        <!-- スマホ用メニュー -->
        <div id="mobileMenu" class="hidden md:hidden mt-3 space-y-2">
            <a href="/trade" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-chart-line mr-2"></i>トレード</a>
            <a href="/mypage" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-user mr-2"></i>マイページ</a>
            <a href="/signal-history" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-history mr-2"></i>サイン結果</a>
            <a href="/ranking" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-trophy mr-2"></i>ランキング</a>
            <a href="/videos" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-video mr-2"></i>動画教材</a>
            <a href="/chat" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-comments mr-2"></i>チャット</a>
            <button onclick="logout()" class="block w-full text-left py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-sign-out-alt mr-2"></i>ログアウト</button>
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
                    <li><i class="fas fa-check text-green-500 mr-2"></i>チャット送信: メッセージ1件につき1ポイント</li>
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
                document.getElementById('balance').textContent = '¥' + Math.round(user.balance).toLocaleString('ja-JP');
                document.getElementById('totalProfit').textContent = '¥' + Math.round(user.total_profit).toLocaleString('ja-JP');
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
                                <span class="\${plColor} font-bold text-lg">¥\${Math.round(pl).toLocaleString('ja-JP')}</span>
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

        function toggleMobileMenu() {
            const menu = document.getElementById('mobileMenu');
            if (menu.classList.contains('hidden')) {
                menu.classList.remove('hidden');
            } else {
                menu.classList.add('hidden');
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
    <!-- メンテナンス予告バナー -->
    <div class="bg-gradient-to-r from-orange-600 to-red-600 text-white py-3 px-4 text-center shadow-lg">
        <div class="container mx-auto flex items-center justify-center">
            <i class="fas fa-exclamation-triangle mr-2 text-xl"></i>
            <span class="font-bold text-sm sm:text-base">
                メンテナンスのお知らせ：日本時間 2月16日(月) 15:00までメンテナンス実施中
            </span>
        </div>
    </div>
    
    <header class="bg-gradient-to-r from-yellow-600 to-yellow-500 text-white p-3 sm:p-4 shadow-lg">
        <div class="container mx-auto flex justify-between items-center">
            <h1 class="text-lg sm:text-xl font-bold"><i class="fas fa-trophy mr-1 sm:mr-2"></i>ランキング</h1>
            <!-- PC用ナビゲーション -->
            <nav class="hidden md:flex space-x-4">
                <a href="/trade" class="hover:text-yellow-200"><i class="fas fa-chart-line mr-1"></i>トレード</a>
                <a href="/mypage" class="hover:text-yellow-200"><i class="fas fa-user mr-1"></i>マイページ</a>
                <a href="/signal-history" class="hover:text-yellow-200"><i class="fas fa-history mr-1"></i>サイン結果</a>
                <a href="/ranking" class="hover:text-yellow-200"><i class="fas fa-trophy mr-1"></i>ランキング</a>
                <a href="/videos" class="hover:text-yellow-200"><i class="fas fa-video mr-1"></i>動画教材</a>
                <a href="/chat" class="hover:text-yellow-200"><i class="fas fa-comments mr-1"></i>チャット</a>
                <button onclick="logout()" class="hover:text-yellow-200"><i class="fas fa-sign-out-alt mr-1"></i>ログアウト</button>
            </nav>
            <!-- スマホ用メニューボタン -->
            <button onclick="toggleMobileMenu()" class="md:hidden text-white">
                <i class="fas fa-bars text-xl"></i>
            </button>
        </div>
        <!-- スマホ用メニュー -->
        <div id="mobileMenu" class="hidden md:hidden mt-3 space-y-2">
            <a href="/trade" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-chart-line mr-2"></i>トレード</a>
            <a href="/mypage" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-user mr-2"></i>マイページ</a>
            <a href="/signal-history" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-history mr-2"></i>サイン結果</a>
            <a href="/ranking" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-trophy mr-2"></i>ランキング</a>
            <a href="/videos" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-video mr-2"></i>動画教材</a>
            <a href="/chat" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-comments mr-2"></i>チャット</a>
            <button onclick="logout()" class="block w-full text-left py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-sign-out-alt mr-2"></i>ログアウト</button>
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
            <div class="bg-red-50 border-l-4 border-red-500 p-4 mb-4">
                <div class="flex items-center">
                    <i class="fas fa-exclamation-triangle text-red-500 text-xl mr-3"></i>
                    <p class="text-sm text-red-700">
                        <strong>重要：</strong>連打系の取引が確認できた場合にはアカウント停止とします。
                    </p>
                </div>
            </div>
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
                                    ¥\${Math.round(user.total_profit).toLocaleString('ja-JP')}
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
                                        利益: ¥\${Math.round(user.total_profit).toLocaleString('ja-JP')}
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

        function toggleMobileMenu() {
            const menu = document.getElementById('mobileMenu');
            if (menu.classList.contains('hidden')) {
                menu.classList.remove('hidden');
            } else {
                menu.classList.add('hidden');
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
    <!-- メンテナンス予告バナー -->
    <div class="bg-gradient-to-r from-orange-600 to-red-600 text-white py-3 px-4 text-center shadow-lg">
        <div class="container mx-auto flex items-center justify-center">
            <i class="fas fa-exclamation-triangle mr-2 text-xl"></i>
            <span class="font-bold text-sm sm:text-base">
                メンテナンスのお知らせ：日本時間 2月16日(月) 15:00までメンテナンス実施中
            </span>
        </div>
    </div>
    
    <header class="bg-gradient-to-r from-yellow-600 to-yellow-500 text-white p-3 sm:p-4 shadow-lg">
        <div class="container mx-auto flex justify-between items-center">
            <h1 class="text-lg sm:text-xl font-bold"><i class="fas fa-video mr-1 sm:mr-2"></i>動画教材</h1>
            <!-- PC用ナビゲーション -->
            <nav class="hidden md:flex space-x-4">
                <a href="/trade" class="hover:text-yellow-200"><i class="fas fa-chart-line mr-1"></i>トレード</a>
                <a href="/mypage" class="hover:text-yellow-200"><i class="fas fa-user mr-1"></i>マイページ</a>
                <a href="/signal-history" class="hover:text-yellow-200"><i class="fas fa-history mr-1"></i>サイン結果</a>
                <a href="/ranking" class="hover:text-yellow-200"><i class="fas fa-trophy mr-1"></i>ランキング</a>
                <a href="/videos" class="hover:text-yellow-200"><i class="fas fa-video mr-1"></i>動画教材</a>
                <a href="/chat" class="hover:text-yellow-200"><i class="fas fa-comments mr-1"></i>チャット</a>
                <button onclick="logout()" class="hover:text-yellow-200"><i class="fas fa-sign-out-alt mr-1"></i>ログアウト</button>
            </nav>
            <!-- スマホ用メニューボタン -->
            <button onclick="toggleMobileMenu()" class="md:hidden text-white">
                <i class="fas fa-bars text-xl"></i>
            </button>
        </div>
        <!-- スマホ用メニュー -->
        <div id="mobileMenu" class="hidden md:hidden mt-3 space-y-2">
            <a href="/trade" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-chart-line mr-2"></i>トレード</a>
            <a href="/mypage" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-user mr-2"></i>マイページ</a>
            <a href="/signal-history" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-history mr-2"></i>サイン結果</a>
            <a href="/ranking" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-trophy mr-2"></i>ランキング</a>
            <a href="/videos" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-video mr-2"></i>動画教材</a>
            <a href="/chat" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-comments mr-2"></i>チャット</a>
            <button onclick="logout()" class="block w-full text-left py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-sign-out-alt mr-2"></i>ログアウト</button>
        </div>
    </header>
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

        function toggleMobileMenu() {
            const menu = document.getElementById('mobileMenu');
            if (menu.classList.contains('hidden')) {
                menu.classList.remove('hidden');
            } else {
                menu.classList.add('hidden');
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

// サイン結果ページ
app.get('/signal-history', (c) => {
  const userId = getCookie(c, 'user_id')
  if (!userId) {
    return c.redirect('/')
  }

  return c.html(`
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>過去のサイン結果 - GOLD10</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
</head>
<body class="bg-gradient-to-br from-gray-900 to-gray-800 min-h-screen">
    <!-- ヘッダー -->
    <div class="bg-gradient-to-r from-yellow-600 to-yellow-500 text-white shadow-lg">
        <div class="container mx-auto px-4 py-3 flex justify-between items-center">
            <h1 class="text-xl font-bold"><i class="fas fa-chart-line mr-2"></i>GOLD10</h1>
            <nav class="hidden md:flex space-x-4 items-center text-sm">
                <a href="/trade" class="hover:text-yellow-200"><i class="fas fa-chart-line mr-1"></i>トレード</a>
                <a href="/mypage" class="hover:text-yellow-200"><i class="fas fa-user mr-1"></i>マイページ</a>
                <a href="/signal-history" class="hover:text-yellow-200"><i class="fas fa-history mr-1"></i>サイン結果</a>
                <a href="/ranking" class="hover:text-yellow-200"><i class="fas fa-trophy mr-1"></i>ランキング</a>
                <a href="/videos" class="hover:text-yellow-200"><i class="fas fa-video mr-1"></i>動画教材</a>
                <a href="/chat" class="hover:text-yellow-200"><i class="fas fa-comments mr-1"></i>チャット</a>
                <button onclick="logout()" class="hover:text-yellow-200"><i class="fas fa-sign-out-alt mr-1"></i>ログアウト</button>
            </nav>
            <button onclick="toggleMobileMenu()" class="md:hidden text-white"><i class="fas fa-bars text-xl"></i></button>
        </div>
        <div id="mobileMenu" class="hidden md:hidden mt-3 space-y-2 container mx-auto px-4 pb-3">
            <a href="/trade" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-chart-line mr-2"></i>トレード</a>
            <a href="/mypage" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-user mr-2"></i>マイページ</a>
            <a href="/signal-history" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-history mr-2"></i>サイン結果</a>
            <a href="/ranking" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-trophy mr-2"></i>ランキング</a>
            <a href="/videos" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-video mr-2"></i>動画教材</a>
            <a href="/chat" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-comments mr-2"></i>チャット</a>
            <button onclick="logout()" class="block w-full text-left py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-sign-out-alt mr-2"></i>ログアウト</button>
        </div>
    </div>

    <div class="container mx-auto px-4 py-8">
        <div class="bg-white rounded-lg shadow-xl p-6">
            <h2 class="text-2xl font-bold mb-6 text-gray-800">
                <i class="fas fa-history mr-2 text-blue-600"></i>直近サイン10回分の結果
            </h2>
            
            <!-- 統計情報 -->
            <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div class="bg-blue-50 rounded-lg p-4 text-center">
                    <div class="text-sm text-gray-600">総サイン数</div>
                    <div id="totalSignals" class="text-3xl font-bold text-blue-600">0</div>
                </div>
                <div class="bg-green-50 rounded-lg p-4 text-center">
                    <div class="text-sm text-gray-600">勝利数</div>
                    <div id="winCount" class="text-3xl font-bold text-green-600">0</div>
                </div>
                <div class="bg-red-50 rounded-lg p-4 text-center">
                    <div class="text-sm text-gray-600">敗北数</div>
                    <div id="lossCount" class="text-3xl font-bold text-red-600">0</div>
                </div>
                <div class="bg-yellow-50 rounded-lg p-4 text-center">
                    <div class="text-sm text-gray-600">勝率</div>
                    <div id="winRate" class="text-3xl font-bold text-yellow-600">0%</div>
                </div>
            </div>

            <!-- サイン一覧 -->
            <div id="signalList" class="space-y-3">
                <p class="text-center text-gray-500 py-8">読み込み中...</p>
            </div>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
    <script>
        function toggleMobileMenu() {
            const menu = document.getElementById('mobileMenu');
            menu.classList.toggle('hidden');
        }

        function logout() {
            document.cookie = 'user_id=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
            window.location.href = '/';
        }

        async function loadSignalHistory() {
            try {
                const response = await axios.get('/api/signal-history');
                const signals = response.data;

                if (signals.length === 0) {
                    document.getElementById('signalList').innerHTML = '<p class="text-center text-gray-500 py-8">直近のサインはありません</p>';
                    return;
                }

                // 統計を計算
                let winCount = 0;
                let lossCount = 0;
                let pendingCount = 0;

                signals.forEach(signal => {
                    if (signal.result === 'win') winCount++;
                    else if (signal.result === 'loss') lossCount++;
                    else pendingCount++;
                });

                const totalSignals = signals.length;
                const winRate = totalSignals > 0 ? ((winCount / (winCount + lossCount)) * 100).toFixed(1) : 0;

                document.getElementById('totalSignals').textContent = totalSignals;
                document.getElementById('winCount').textContent = winCount;
                document.getElementById('lossCount').textContent = lossCount;
                document.getElementById('winRate').textContent = winRate + '%';

                // サイン一覧を表示
                const signalList = document.getElementById('signalList');
                signalList.innerHTML = signals.map(signal => {
                    const time = new Date(signal.timestamp * 1000).toLocaleString('ja-JP', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit'
                    });

                    const typeColor = signal.type === 'BUY' ? 'text-green-600' : 'text-red-600';
                    const typeIcon = signal.type === 'BUY' ? 'fa-arrow-up' : 'fa-arrow-down';
                    const typeText = signal.type === 'BUY' ? '買いサイン' : '売りサイン';

                    let resultBadge = '';
                    if (signal.result === 'win') {
                        resultBadge = '<span class="bg-green-500 text-white px-3 py-1 rounded-full text-sm font-bold"><i class="fas fa-check mr-1"></i>勝利</span>';
                    } else if (signal.result === 'loss') {
                        resultBadge = '<span class="bg-red-500 text-white px-3 py-1 rounded-full text-sm font-bold"><i class="fas fa-times mr-1"></i>敗北</span>';
                    } else {
                        resultBadge = '<span class="bg-gray-400 text-white px-3 py-1 rounded-full text-sm font-bold"><i class="fas fa-clock mr-1"></i>判定待ち</span>';
                    }

                    return \`
                        <div class="bg-gray-50 rounded-lg p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                            <div class="flex-1">
                                <div class="flex items-center gap-2 mb-2">
                                    <i class="fas \${typeIcon} \${typeColor} text-xl"></i>
                                    <span class="font-bold \${typeColor}">\${typeText}</span>
                                    <span class="text-gray-500 text-sm">\${time}</span>
                                </div>
                                <div class="text-sm text-gray-600">
                                    <span class="font-bold">点灯価格:</span> $\${signal.price.toFixed(2)}
                                    \${signal.targetPrice ? \` → <span class="font-bold">5本後価格:</span> $\${signal.targetPrice.toFixed(2)}\` : ''}
                                    \${signal.targetPrice ? \` <span class="\${signal.result === 'win' ? 'text-green-600' : 'text-red-600'} font-bold">(\${signal.type === 'BUY' ? (signal.targetPrice > signal.price ? '+' : '') : (signal.targetPrice < signal.price ? '-' : '+')}$\${Math.abs(signal.targetPrice - signal.price).toFixed(2)})</span>\` : ''}
                                </div>
                            </div>
                            <div>
                                \${resultBadge}
                            </div>
                        </div>
                    \`;
                }).join('');

            } catch (error) {
                console.error('サイン履歴取得エラー:', error);
                document.getElementById('signalList').innerHTML = '<p class="text-center text-red-500 py-8">データの取得に失敗しました</p>';
            }
        }

        // ページ読み込み時にデータを取得
        window.addEventListener('load', loadSignalHistory);

        // 30秒ごとに自動更新
        setInterval(loadSignalHistory, 30000);
    </script>
</body>
</html>
  `)
})

// サイン結果API（勝敗判定付き）
app.get('/api/signal-history', async (c) => {
  // 直近10回分のサインを取得（未来のサインは除外）
  const now = Math.floor(Date.now() / 1000)
  
  const signals = await c.env.DB.prepare(`
    SELECT * FROM gold10_signals
    WHERE timestamp <= ?
    ORDER BY timestamp DESC
    LIMIT 10
  `).bind(now).all()

  // 各サインの勝敗を判定
  const signalsWithResult = await Promise.all((signals.results || []).map(async (signal: any) => {
    // サイン点灯時刻から5本後（5 * 30秒 = 150秒後）のローソク足を取得
    const targetTime = signal.timestamp + 150
    
    const targetCandle = await c.env.DB.prepare(`
      SELECT close FROM gold10_candles
      WHERE timestamp >= ?
      ORDER BY timestamp ASC
      LIMIT 1
    `).bind(targetTime).first() as { close: number } | null

    let result = 'pending' // 'win', 'loss', 'pending'
    
    if (targetCandle) {
      if (signal.type === 'BUY') {
        // 買いサイン：5本後の価格がサイン価格より上がっていれば勝ち
        result = targetCandle.close > signal.price ? 'win' : 'loss'
      } else {
        // 売りサイン：5本後の価格がサイン価格より下がっていれば勝ち
        result = targetCandle.close < signal.price ? 'win' : 'loss'
      }
    }

    return {
      ...signal,
      result,
      targetPrice: targetCandle?.close
    }
  }))

  return c.json(signalsWithResult)
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
    <!-- メンテナンス予告バナー -->
    <div class="bg-gradient-to-r from-orange-600 to-red-600 text-white py-3 px-4 text-center shadow-lg">
        <div class="container mx-auto flex items-center justify-center">
            <i class="fas fa-exclamation-triangle mr-2 text-xl"></i>
            <span class="font-bold text-sm sm:text-base">
                メンテナンスのお知らせ：日本時間 2月16日(月) 15:00までメンテナンス実施中
            </span>
        </div>
    </div>
    
    <header class="bg-gradient-to-r from-yellow-600 to-yellow-500 text-white p-3 sm:p-4 shadow-lg">
        <div class="container mx-auto flex justify-between items-center">
            <h1 class="text-lg sm:text-xl font-bold"><i class="fas fa-comments mr-1 sm:mr-2"></i>オンラインチャット</h1>
            <!-- PC用ナビゲーション -->
            <nav class="hidden md:flex space-x-4">
                <a href="/trade" class="hover:text-yellow-200"><i class="fas fa-chart-line mr-1"></i>トレード</a>
                <a href="/mypage" class="hover:text-yellow-200"><i class="fas fa-user mr-1"></i>マイページ</a>
                <a href="/signal-history" class="hover:text-yellow-200"><i class="fas fa-history mr-1"></i>サイン結果</a>
                <a href="/ranking" class="hover:text-yellow-200"><i class="fas fa-trophy mr-1"></i>ランキング</a>
                <a href="/videos" class="hover:text-yellow-200"><i class="fas fa-video mr-1"></i>動画教材</a>
                <a href="/chat" class="hover:text-yellow-200"><i class="fas fa-comments mr-1"></i>チャット</a>
                <button onclick="logout()" class="hover:text-yellow-200"><i class="fas fa-sign-out-alt mr-1"></i>ログアウト</button>
            </nav>
            <!-- スマホ用メニューボタン -->
            <button onclick="toggleMobileMenu()" class="md:hidden text-white">
                <i class="fas fa-bars text-xl"></i>
            </button>
        </div>
        <!-- スマホ用メニュー -->
        <div id="mobileMenu" class="hidden md:hidden mt-3 space-y-2">
            <a href="/trade" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-chart-line mr-2"></i>トレード</a>
            <a href="/mypage" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-user mr-2"></i>マイページ</a>
            <a href="/signal-history" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-history mr-2"></i>サイン結果</a>
            <a href="/ranking" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-trophy mr-2"></i>ランキング</a>
            <a href="/videos" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-video mr-2"></i>動画教材</a>
            <a href="/chat" class="block py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-comments mr-2"></i>チャット</a>
            <button onclick="logout()" class="block w-full text-left py-2 hover:bg-yellow-700 rounded px-2"><i class="fas fa-sign-out-alt mr-2"></i>ログアウト</button>
        </div>
    </header>
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
                const response = await axios.post('/api/chat/messages', { message });
                input.value = '';
                await loadMessages();
                
                // 🎁 ポイント獲得アラート（チャットページ用）
                if (response.data.pointsAwarded) {
                    // 簡易通知を表示
                    const tempNotification = document.createElement('div');
                    tempNotification.className = 'fixed top-4 right-4 bg-yellow-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-bounce';
                    tempNotification.innerHTML = '<i class="fas fa-star mr-2"></i>+1ポイント獲得！';
                    document.body.appendChild(tempNotification);
                    
                    setTimeout(() => {
                        tempNotification.remove();
                    }, 2000);
                }
            } catch (error) {
                alert('メッセージ送信に失敗しました');
            }
        });

        function toggleMobileMenu() {
            const menu = document.getElementById('mobileMenu');
            if (menu.classList.contains('hidden')) {
                menu.classList.remove('hidden');
            } else {
                menu.classList.add('hidden');
            }
        }

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
            <button onclick="showTab('system')" id="systemTab" class="flex-1 bg-red-500 text-white font-bold py-3 rounded-lg shadow">
                <i class="fas fa-chart-line mr-2"></i>システム情報
            </button>
            <button onclick="showTab('users')" id="usersTab" class="flex-1 bg-white text-gray-700 font-bold py-3 rounded-lg shadow">
                <i class="fas fa-users mr-2"></i>ユーザー管理
            </button>
            <button onclick="showTab('videos')" id="videosTab" class="flex-1 bg-white text-gray-700 font-bold py-3 rounded-lg shadow">
                <i class="fas fa-video mr-2"></i>動画管理
            </button>
            <button onclick="showTab('chat')" id="chatTab" class="flex-1 bg-white text-gray-700 font-bold py-3 rounded-lg shadow">
                <i class="fas fa-comments mr-2"></i>チャット管理
            </button>
        </div>

        <!-- システム情報 -->
        <div id="systemPanel" class="space-y-4">
            <!-- サイン生成コントロール -->
            <div class="bg-white rounded-lg shadow-md p-6">
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <div class="bg-yellow-50 rounded-lg p-4">
                        <div class="text-sm text-gray-600 mb-1">総ローソク足数</div>
                        <div id="totalCandles" class="text-xl font-bold text-yellow-700">--</div>
                    </div>
                    <div class="bg-purple-50 rounded-lg p-4">
                        <div class="text-sm text-gray-600 mb-1">総サイン数</div>
                        <div id="totalSignals" class="text-xl font-bold text-purple-700">--</div>
                    </div>
                    <div class="bg-indigo-50 rounded-lg p-4">
                        <div class="text-sm text-gray-600 mb-1">現在価格</div>
                        <div id="currentGoldPrice" class="text-xl font-bold text-indigo-700">--</div>
                    </div>
                </div>
                
                <!-- サイン生成 -->
                <div class="border-t pt-6">
                    <h3 class="text-lg font-bold mb-4 text-gray-800">
                        <i class="fas fa-bell mr-2 text-green-500"></i>サイン生成
                    </h3>
                    
                    <!-- 即座にサイン生成 -->
                    <div class="mb-6">
                        <label class="block text-sm font-medium text-gray-700 mb-2">即座にサイン生成</label>
                        <div class="flex gap-3">
                            <button onclick="generateSignalNow('BUY')" class="flex-1 bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg font-bold transition">
                                <i class="fas fa-arrow-up mr-2"></i>買いサイン生成
                            </button>
                            <button onclick="generateSignalNow('SELL')" class="flex-1 bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg font-bold transition">
                                <i class="fas fa-arrow-down mr-2"></i>売りサイン生成
                            </button>
                        </div>
                    </div>
                    
                    <!-- サイン予約 -->
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">サイン予約</label>
                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label class="block text-xs text-gray-600 mb-1">サインタイプ</label>
                                <select id="reserveSignalType" class="w-full px-3 py-2 border border-gray-300 rounded-lg">
                                    <option value="BUY">買いサイン</option>
                                    <option value="SELL">売りサイン</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-xs text-gray-600 mb-1">予約時間</label>
                                <select id="reserveHours" class="w-full px-3 py-2 border border-gray-300 rounded-lg">
                                    <option value="1">1時間後</option>
                                    <option value="2">2時間後</option>
                                    <option value="3">3時間後</option>
                                    <option value="4">4時間後</option>
                                    <option value="5">5時間後</option>
                                    <option value="6">6時間後</option>
                                </select>
                            </div>
                        </div>
                        <button onclick="reserveSignal()" class="w-full mt-3 bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg font-bold transition">
                            <i class="fas fa-clock mr-2"></i>サインを予約
                        </button>
                    </div>
                    
                    <!-- 予約リスト -->
                    <div class="mt-4 bg-gray-50 rounded-lg p-4">
                        <h4 class="text-sm font-bold text-gray-700 mb-2">予約済みサイン</h4>
                        <div id="reservedSignalsList" class="text-sm text-gray-600">
                            予約なし
                        </div>
                    </div>
                </div>
            </div>
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
            
            <!-- 一括ユーザー登録フォーム -->
            <div class="bg-white rounded-lg shadow-md p-6">
                <h2 class="text-2xl font-bold mb-4">
                    <i class="fas fa-users mr-2 text-blue-500"></i>一括ユーザー登録
                </h2>
                <form id="bulkAddUserForm" class="space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            ユーザーデータ（1行に1ユーザー：パスワード[タブまたはスペース]ユーザー名）
                        </label>
                        <textarea 
                            id="bulkUserData" 
                            rows="10"
                            class="w-full px-4 py-2 border border-gray-300 rounded-lg font-mono text-sm"
                            placeholder="953170f	arinchu
098610l	WAVE(吉田)
531536o	イシマセイタ"
                            required
                        ></textarea>
                        <p class="text-xs text-gray-500 mt-1">
                            各行は「パスワード ユーザー名」の形式で入力してください（タブまたはスペース区切り）
                        </p>
                    </div>
                    <button 
                        type="submit"
                        class="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 rounded-lg"
                    >
                        <i class="fas fa-upload mr-2"></i>一括登録
                    </button>
                </form>
                <div id="bulkAddResult" class="mt-4 hidden">
                    <div class="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded">
                        <p class="font-bold">登録結果:</p>
                        <p id="bulkAddMessage"></p>
                    </div>
                </div>
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
                        <label class="block text-sm font-medium text-gray-700 mb-2">カテゴリ</label>
                        <select 
                            id="videoCategory" 
                            class="w-full px-4 py-2 border border-gray-300 rounded-lg"
                            required
                        >
                            <option value="環境設定">環境設定</option>
                            <option value="トレード基礎">トレード基礎</option>
                            <option value="その他">その他</option>
                        </select>
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

        <!-- チャット管理 -->
        <div id="chatPanel" class="space-y-4 hidden">
            <div class="bg-white rounded-lg shadow-md p-6">
                <h2 class="text-2xl font-bold mb-4">
                    <i class="fas fa-comments mr-2 text-red-500"></i>チャットメッセージ一覧
                </h2>
                <div id="adminChatList" class="space-y-2 max-h-[600px] overflow-y-auto">
                    <p class="text-center text-gray-500 py-4">読み込み中...</p>
                </div>
            </div>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
    <script>
        function showTab(tab) {
            // パネルの表示切り替え
            document.getElementById('systemPanel').classList.add('hidden');
            document.getElementById('usersPanel').classList.add('hidden');
            document.getElementById('videosPanel').classList.add('hidden');
            document.getElementById('chatPanel').classList.add('hidden');
            
            // タブのスタイル切り替え
            document.getElementById('systemTab').className = 'flex-1 bg-white text-gray-700 font-bold py-3 rounded-lg shadow';
            document.getElementById('usersTab').className = 'flex-1 bg-white text-gray-700 font-bold py-3 rounded-lg shadow';
            document.getElementById('videosTab').className = 'flex-1 bg-white text-gray-700 font-bold py-3 rounded-lg shadow';
            document.getElementById('chatTab').className = 'flex-1 bg-white text-gray-700 font-bold py-3 rounded-lg shadow';
            
            if (tab === 'system') {
                document.getElementById('systemPanel').classList.remove('hidden');
                document.getElementById('systemTab').className = 'flex-1 bg-red-500 text-white font-bold py-3 rounded-lg shadow';
                loadSystemInfo();
            } else if (tab === 'users') {
                document.getElementById('usersPanel').classList.remove('hidden');
                document.getElementById('usersTab').className = 'flex-1 bg-red-500 text-white font-bold py-3 rounded-lg shadow';
            } else if (tab === 'videos') {
                document.getElementById('videosPanel').classList.remove('hidden');
                document.getElementById('videosTab').className = 'flex-1 bg-red-500 text-white font-bold py-3 rounded-lg shadow';
                loadAdminVideos();
            } else if (tab === 'chat') {
                document.getElementById('chatPanel').classList.remove('hidden');
                document.getElementById('chatTab').className = 'flex-1 bg-red-500 text-white font-bold py-3 rounded-lg shadow';
                loadAdminChat();
            }
        }
        
        // システム情報を読み込み
        async function loadSystemInfo() {
            try {
                // 【サイン機能完全無効化】サイン情報の取得を無効化
                // const signalsResponse = await axios.get('/api/gold10/signals?hours=12');
                // const signals = signalsResponse.data;
                
                // ローソク足情報を取得
                const candlesResponse = await axios.get('/api/gold10/candles?hours=12');
                const candles = candlesResponse.data;
                document.getElementById('totalCandles').textContent = candles.length + '本';
                
                // サイン数（サイン機能無効化のため0固定）
                document.getElementById('totalSignals').textContent = '0本';
                
                // 現在価格
                if (candles.length > 0) {
                    const latest = candles[candles.length - 1];
                    document.getElementById('currentGoldPrice').textContent = '$' + latest.close.toFixed(2);
                }
            } catch (error) {
                console.error('システム情報取得エラー:', error);
            }
        }

        // 即座にサイン生成【サイン機能完全無効化】
        async function generateSignalNow(type) {
            alert('サイン生成機能は現在無効化されています');
            return;
            
            /* 【サイン機能完全無効化】
            if (!confirm(\`\${type === 'BUY' ? '買い' : '売り'}サインを生成しますか？\`)) {
                return;
            }
            
            try {
                const response = await axios.post('/api/admin/gold10/generate-signal', { type });
                alert(response.data.message);
                loadSystemInfo(); // 統計を更新
            } catch (error) {
                console.error('サイン生成エラー:', error);
                if (error.response?.status === 403) {
                    alert('管理者権限がありません');
                    window.location.href = '/admin-login';
                } else {
                    alert('サイン生成に失敗しました: ' + (error.response?.data?.error || error.message));
                }
            }
            */
        }

        // サイン予約【サイン機能完全無効化】
        async function reserveSignal() {
            alert('サイン予約機能は現在無効化されています');
            return;
            
            /* 【サイン機能完全無効化】
            const type = document.getElementById('reserveSignalType').value;
            const hours = parseInt(document.getElementById('reserveHours').value);
            
            if (!confirm(\`\${hours}時間後に\${type === 'BUY' ? '買い' : '売り'}サインを予約しますか？\`)) {
                return;
            }
            
            try {
                const response = await axios.post('/api/admin/gold10/reserve-signal', { type, hours });
                alert(response.data.message);
                loadReservedSignals(); // 予約リストを更新
            } catch (error) {
                console.error('サイン予約エラー:', error);
                if (error.response?.status === 403) {
                    alert('管理者権限がありません');
                    window.location.href = '/admin-login';
                } else {
                    alert('サイン予約に失敗しました: ' + (error.response?.data?.error || error.message));
                }
            }
            */
        }
            }
        }

        // 予約サイン一覧を読み込み
        async function loadReservedSignals() {
            try {
                const response = await axios.get('/api/admin/gold10/reserved-signals');
                const container = document.getElementById('reservedSignalsList');
                
                if (response.data.reservations.length === 0) {
                    container.textContent = '予約なし';
                } else {
                    container.innerHTML = response.data.reservations.map(r => {
                        const time = new Date(r.reserveTimeStr);
                        return \`<div class="py-1">\${r.type === 'BUY' ? '買い' : '売り'}サイン - \${time.toLocaleString('ja-JP')}</div>\`;
                    }).join('');
                }
            } catch (error) {
                console.error('予約サイン取得エラー:', error);
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
        
        // 一括ユーザー登録
        document.getElementById('bulkAddUserForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const bulkData = document.getElementById('bulkUserData').value;
            const lines = bulkData.trim().split('\\n');
            
            let successCount = 0;
            let errorCount = 0;
            const errors = [];
            
            document.getElementById('bulkAddResult').classList.add('hidden');
            
            for (const line of lines) {
                if (!line.trim()) continue;
                
                // タブまたはスペースで分割
                const parts = line.trim().split(/[\\t\\s]+/);
                if (parts.length < 1) continue;
                
                const password = parts[0];
                const username = parts.slice(1).join(' ') || '';
                
                try {
                    await axios.post('/api/admin/users', { password, username });
                    successCount++;
                } catch (error) {
                    errorCount++;
                    errors.push(\`\${password}: \${error.response?.data?.error || 'エラー'}\`);
                }
                
                // 少し待機（サーバー負荷軽減）
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            // 結果表示
            const resultDiv = document.getElementById('bulkAddResult');
            const messageDiv = document.getElementById('bulkAddMessage');
            resultDiv.classList.remove('hidden');
            
            if (errorCount === 0) {
                resultDiv.querySelector('div').className = 'bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded';
                messageDiv.textContent = \`成功: \${successCount}件のユーザーを登録しました\`;
            } else {
                resultDiv.querySelector('div').className = 'bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded';
                messageDiv.innerHTML = \`成功: \${successCount}件 | 失敗: \${errorCount}件<br><br>エラー詳細:<br>\${errors.join('<br>')}\`;
            }
            
            document.getElementById('bulkAddUserForm').reset();
            await loadUsers();
        });

        document.getElementById('addVideoForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const title = document.getElementById('videoTitle').value;
            const category = document.getElementById('videoCategory').value;
            const youtubeUrl = document.getElementById('videoUrl').value;
            const orderIndex = parseInt(document.getElementById('videoOrder').value) || 0;

            try {
                await axios.post('/api/admin/videos', { title, youtubeUrl, orderIndex, category });
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

        async function loadAdminChat() {
            try {
                const response = await axios.get('/api/chat/messages');
                const messages = response.data;
                const container = document.getElementById('adminChatList');
                
                if (messages.length === 0) {
                    container.innerHTML = '<p class="text-center text-gray-500 py-4">メッセージがありません</p>';
                    return;
                }

                container.innerHTML = messages.map(msg => {
                    const date = new Date(msg.created_at).toLocaleString('ja-JP');
                    return \`
                        <div class="border border-gray-200 rounded-lg p-4 hover:bg-gray-50">
                            <div class="flex justify-between items-start mb-2">
                                <div class="flex-1">
                                    <div class="font-bold text-gray-800">\${msg.username}</div>
                                    <div class="text-sm text-gray-500">\${date}</div>
                                </div>
                                <button 
                                    onclick="deleteChatMessage(\${msg.id})"
                                    class="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded text-sm"
                                >
                                    <i class="fas fa-trash mr-1"></i>削除
                                </button>
                            </div>
                            <div class="text-gray-700">\${msg.message}</div>
                        </div>
                    \`;
                }).join('');
            } catch (error) {
                console.error('チャット取得エラー:', error);
            }
        }

        async function deleteChatMessage(id) {
            if (!confirm('このメッセージを削除しますか？')) return;

            try {
                await axios.delete(\`/api/chat/messages/\${id}\`);
                alert('メッセージを削除しました');
                await loadAdminChat();
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

        // 初期化
        loadUsers();
        loadAdminVideos();
        loadSystemInfo();
        loadReservedSignals(); // 予約リストも読み込み
        
        // 10秒ごとにシステム情報を更新
        setInterval(() => {
            const systemPanel = document.getElementById('systemPanel');
            if (!systemPanel.classList.contains('hidden')) {
                loadSystemInfo();
                loadReservedSignals(); // 予約リストも更新
            }
        }, 10000);
    </script>
</body>
</html>
  `)
})

// 管理者モニター画面は削除されました（新しい連続価格モデルAPIのみ使用）

export default app
