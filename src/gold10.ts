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
 */
export function generateCandle(previousCandle: Candle | null, basePrice: number = 4950): Candle {
  let timestamp: number
  
  if (previousCandle) {
    // 前のローソク足のタイムスタンプ + 60秒
    timestamp = previousCandle.timestamp + 60
  } else {
    // 初回生成時は現在時刻を60秒単位に丸める
    const now = Math.floor(Date.now() / 1000)
    timestamp = Math.floor(now / 60) * 60
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
 * - 1時間に約2.7回のサイン発生
 * - つまり17-28分に1回程度
 */
export function shouldGenerateSignal(lastSignalTime: number | null): boolean {
  const now = Math.floor(Date.now() / 1000)
  
  if (!lastSignalTime) {
    // 初回は15%の確率で生成
    return Math.random() < 0.15
  }

  const timeSinceLastSignal = now - lastSignalTime
  const minInterval = 17 * 60  // 17分
  const maxInterval = 28 * 60  // 28分

  // 最小間隔を超えていない場合は生成しない
  if (timeSinceLastSignal < minInterval) {
    return false
  }

  // 最大間隔を超えている場合は必ず生成
  if (timeSinceLastSignal >= maxInterval) {
    return true
  }

  // 17-28分の間は徐々に確率が上がる
  const probability = (timeSinceLastSignal - minInterval) / (maxInterval - minInterval)
  return Math.random() < probability
}

/**
 * 反転サインを生成
 * - RSIが65-35の範囲内なら勝率が高い（85%）
 * - 範囲外なら勝率が低い（65%）
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

  // 勝率計算
  let winRate = 0.75  // 基本勝率75%

  // RSIが65-35の範囲内なら勝率アップ
  if (rsi >= 35 && rsi <= 65) {
    winRate = 0.85  // 85%
  } else {
    winRate = 0.65  // 65%
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
    const timestamp = startTime + (i * 60)
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
