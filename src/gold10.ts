/**
 * GOLD10 練習チャート - ローソク足生成とサインロジック
 */

// ローソク足データ型
export interface Candle {
  id?: number
  timestamp: number  // Unix timestamp (秒)
  open: number
  high: number
  low: number
  close: number
  rsi?: number
}

// サインデータ型
export interface Signal {
  id?: number
  candle_id: number
  timestamp: number
  type: 'BUY' | 'SELL'
  price: number
  target_price: number
  success: number | null  // 1=勝ち, 0=負け, null=未確定
  rsi?: number
}

/**
 * RSI計算（14期間）
 */
export function calculateRSI(candles: Candle[], period: number = 14): number {
  if (candles.length < period + 1) {
    return 50 // データ不足の場合は中立値
  }

  // 最新から period+1 個の終値を取得
  const closes = candles.slice(-period - 1).map(c => c.close)
  
  // 価格変動を計算
  const changes: number[] = []
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1])
  }

  // 平均上昇幅と平均下落幅を計算
  let gainSum = 0
  let lossSum = 0
  
  for (const change of changes) {
    if (change > 0) {
      gainSum += change
    } else {
      lossSum += Math.abs(change)
    }
  }

  const avgGain = gainSum / period
  const avgLoss = lossSum / period

  if (avgLoss === 0) {
    return 100
  }

  const rs = avgGain / avgLoss
  const rsi = 100 - (100 / (1 + rs))

  return rsi
}

/**
 * 新しいローソク足を生成
 * - GOLD価格帯: $4,900-$5,100
 * - リアルなローソク足パターンを生成
 * - currentTime: 現在のUNIXタイムスタンプ（秒）。指定しない場合はDate.now()を使用
 */
export function generateCandle(previousCandle: Candle | null, basePrice: number = 4950, currentTime?: number): Candle {
  let timestamp: number
  
  // 現在時刻（引数で渡されない場合はDate.now()を使用）
  const now = currentTime !== undefined ? currentTime : Math.floor(Date.now() / 1000)
  
  if (previousCandle) {
    // 前のローソク足のタイムスタンプ + 30秒（30秒足）
    const nextTimestamp = previousCandle.timestamp + 30
    
    // 🔒 次のタイムスタンプが現在時刻を大きく超えている場合は現在時刻を使用
    if (nextTimestamp > now + 60) {
      // 異常な未来の時刻になる場合は、現在時刻を30秒単位に丸めて使用
      timestamp = Math.floor(now / 30) * 30
    } else {
      timestamp = nextTimestamp
    }
  } else {
    // 初回生成時は現在時刻を30秒単位に丸める
    timestamp = Math.floor(now / 30) * 30
  }

  let open: number
  let close: number
  let high: number
  let low: number

  if (previousCandle) {
    // 前のローソク足の終値を始値とする
    open = previousCandle.close
  } else {
    // 初回生成時
    open = basePrice
  }

  // トレンド方向をランダムに決定（上昇50%、下降50%）
  const isUptrend = Math.random() > 0.5

  // 価格変動幅（$2-$20の範囲でより波打つ）
  const priceMove = 2 + Math.random() * 18

  if (isUptrend) {
    close = open + priceMove * (0.2 + Math.random() * 0.8)
    high = Math.max(open, close) + Math.random() * 5
    low = Math.min(open, close) - Math.random() * 3
  } else {
    close = open - priceMove * (0.2 + Math.random() * 0.8)
    high = Math.max(open, close) + Math.random() * 3
    low = Math.min(open, close) - Math.random() * 5
  }
  
  return {
    timestamp,
    open,
    high,
    low,
    close
  }
}

/**
 * 反転サインを生成すべきか判定
 * - 30本のローソク足に1回のサイン発生（1時間に2回）
 * - つまり25-35分に1回程度
 */
export function shouldGenerateSignal(lastSignalTime: number | null): boolean {
  const now = Math.floor(Date.now() / 1000)
  
  if (!lastSignalTime) {
    // 初回は3%の確率で生成（30本に1回）
    return Math.random() < 0.03
  }

  const timeSinceLastSignal = now - lastSignalTime
  const minInterval = 25 * 60  // 25分
  const maxInterval = 35 * 60  // 35分

  // 最小間隔を超えていない場合は生成しない
  if (timeSinceLastSignal < minInterval) {
    return false
  }

  // 最大間隔を超えている場合は必ず生成
  if (timeSinceLastSignal >= maxInterval) {
    return true
  }

  // 25-35分の間は徐々に確率が上がる
  const probability = (timeSinceLastSignal - minInterval) / (maxInterval - minInterval)
  return Math.random() < probability
}

/**
 * 反転サインを生成
 * - 21:30-22:00のサインは必ず勝つ（100%）
 * - 過度なトレンド時（RSI > 60 または RSI < 36）は負けやすい（40%）
 * - 月曜日の16:00-19:00は連敗しやすい（30%）
 * - RSIが36-60の範囲内なら勝率が高い（85%）
 * - 基本勝率は75%
 */
export function generateSignal(candle: Candle, candleId: number, rsi: number): Signal {
  // サインタイプを決定（50%の確率でBUYまたはSELL）
  const type: 'BUY' | 'SELL' = Math.random() > 0.5 ? 'BUY' : 'SELL'

  // サイン価格（ローソク足の終値）
  const price = candle.close

  // 目標価格（約5ドル先）
  const targetMove = 4.5 + Math.random() * 1.0  // $4.5-$5.5
  const target_price = type === 'BUY' 
    ? price + targetMove 
    : price - targetMove

  // 日本時間を取得（UTC+9）
  const signalDate = new Date(candle.timestamp * 1000)
  const jstOffset = 9 * 60 * 60 * 1000  // 9時間のミリ秒
  const jstDate = new Date(signalDate.getTime() + jstOffset)
  const dayOfWeek = jstDate.getUTCDay()  // 0=日曜, 1=月曜, ...
  const hour = jstDate.getUTCHours()
  const minute = jstDate.getUTCMinutes()

  // 勝率計算
  let winRate = 0.75  // 基本勝率75%

  // 【優先度1】21:30-22:00のサインは必ず勝つ
  if (hour === 21 && minute >= 30) {
    winRate = 1.0  // 100%勝利
  } else if (hour === 22 && minute === 0) {
    winRate = 1.0  // 100%勝利
  }
  // 【優先度2】月曜日の16:00-19:00は連敗しやすい
  else if (dayOfWeek === 1 && hour >= 16 && hour < 19) {
    winRate = 0.3  // 30%勝率
  }
  // 【優先度3】過度なトレンド時（RSI > 60 または RSI < 36）は負けやすい
  else if (rsi > 60 || rsi < 36) {
    winRate = 0.4  // 40%勝率
  }
  // 【優先度4】RSIが36-60の範囲内なら勝率アップ
  else if (rsi >= 36 && rsi <= 60) {
    winRate = 0.85  // 85%勝率
  }

  // 勝ち/負けを決定（実際の反転は3つ後のローソク足で判定）
  const success = Math.random() < winRate ? 1 : 0

  return {
    candle_id: candleId,
    timestamp: candle.timestamp,
    type,
    price,
    target_price,
    success,
    rsi
  }
}

/**
 * 初期データ生成（過去12時間分のローソク足）
 */
export function generateInitialCandles(count: number = 720): Candle[] {
  const candles: Candle[] = []
  const basePrice = 4950
  const now = Math.floor(Date.now() / 1000)
  const startTime = now - (count * 60)  // 12時間前から

  let previousCandle: Candle | null = null

  for (let i = 0; i < count; i++) {
    const timestamp = startTime + (i * 30)  // 30秒間隔（30秒足）
    const candle = generateCandle(previousCandle, basePrice)
    candle.timestamp = timestamp

    candles.push(candle)
    previousCandle = candle
  }

  return candles
}

/**
 * 初期サインデータ生成
 * - 12時間分のローソク足から、反転しそうなポイントにサインを生成
 * - 1時間あたり約2.7回のサイン（合計約32回）
 * - candlesはDB IDを含む必要がある
 */
export function generateInitialSignals(candles: Candle[]): Signal[] {
  const signals: Signal[] = []
  
  // サイン発生間隔（分）の配列を生成
  const signalIntervals: number[] = []
  let currentIndex = Math.floor(Math.random() * 30) + 15  // 最初のサインは15-45分後
  
  while (currentIndex < candles.length - 10) {
    signalIntervals.push(currentIndex)
    // 次のサインまで17-28分（ランダム）、平均22.5分
    currentIndex += Math.floor(Math.random() * 12) + 17
  }
  
  // 各サイン発生ポイントでサインを生成
  for (const index of signalIntervals) {
    if (index >= 14 && candles[index] && candles[index].id) {  // RSI計算に必要な最低本数
      const candle = candles[index]
      const candleId = candle.id as number  // DB上の実際のID
      
      // RSIを取得（既に計算済みの場合）
      const rsi = candle.rsi || 50
      
      // サイン生成
      const signal = generateSignal(candle, candleId, rsi)
      signals.push(signal)
    }
  }
  
  return signals
}
