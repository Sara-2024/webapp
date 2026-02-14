// 過去10時間分のローソク足を一括生成するスクリプト
const fs = require('fs');

const CANDLES_COUNT = 600; // 10時間分（600本）

// RSI計算（14期間）
function calculateRSI(candles, period = 14) {
  if (candles.length < period + 1) {
    return 50; // データ不足の場合は中立値
  }

  const closes = candles.slice(-period - 1).map(c => c.close);
  const changes = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }

  let gainSum = 0;
  let lossSum = 0;
  for (const change of changes) {
    if (change > 0) {
      gainSum += change;
    } else {
      lossSum += Math.abs(change);
    }
  }

  const avgGain = gainSum / period;
  const avgLoss = lossSum / period;

  if (avgLoss === 0) {
    return 100;
  }

  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));
  return rsi;
}

// ローソク足生成
function generateCandle(previousCandle, basePrice = 4950) {
  let timestamp = previousCandle ? previousCandle.timestamp + 60 : Math.floor(Date.now() / 1000);
  let open = previousCandle ? previousCandle.close : basePrice;
  
  const isUptrend = Math.random() > 0.5;
  const priceMove = 2 + Math.random() * 18;
  
  let close;
  if (isUptrend) {
    close = open + priceMove * (0.2 + Math.random() * 0.8);
  } else {
    close = open - priceMove * (0.2 + Math.random() * 0.8);
  }
  
  let high, low;
  if (isUptrend) {
    high = Math.max(open, close) + Math.random() * 5;
    low = Math.min(open, close) - Math.random() * 3;
  } else {
    high = Math.max(open, close) + Math.random() * 3;
    low = Math.min(open, close) - Math.random() * 5;
  }
  
  return { timestamp, open, high, low, close };
}

// サイン生成
function generateSignal(candle, candleId, rsi) {
  const type = Math.random() > 0.5 ? 'BUY' : 'SELL';
  const price = candle.close;
  const targetMove = 4.5 + Math.random() * 1.0;
  const target_price = type === 'BUY' ? price + targetMove : price - targetMove;
  
  // 勝率計算
  const date = new Date(candle.timestamp * 1000);
  const hour = date.getUTCHours();
  const day = date.getUTCDay();
  
  let winRate = 0.75; // デフォルト勝率
  
  if (hour === 12 || hour === 13) { // 21:30-22:00 JST (12:30-13:00 UTC)
    winRate = 1.0;
  } else if (day === 1 && hour >= 7 && hour < 10) { // 月曜16:00-19:00 JST
    winRate = 0.3;
  } else if (rsi > 60 || rsi < 36) {
    winRate = 0.4;
  } else if (rsi >= 36 && rsi <= 60) {
    winRate = 0.85;
  }
  
  const success = Math.random() < winRate ? 1 : 0;
  
  return {
    candle_id: candleId,
    timestamp: candle.timestamp,
    type,
    price,
    target_price,
    success,
    rsi
  };
}

async function generateHistoricalCandles() {
  console.log(`🚀 過去10時間分のローソク足（${CANDLES_COUNT}本）を生成します...`);
  
  const now = Math.floor(Date.now() / 1000);
  const startTime = now - (CANDLES_COUNT * 60); // 10時間前
  
  const candles = [];
  let previousCandle = null;
  
  // ローソク足を生成
  for (let i = 0; i < CANDLES_COUNT; i++) {
    const candle = generateCandle(previousCandle, 4950);
    candle.timestamp = startTime + (i * 60); // タイムスタンプを手動で設定
    candles.push(candle);
    previousCandle = candle;
  }
  
  console.log(`✅ ${candles.length}本のローソク足を生成しました`);
  
  // RSIを計算
  console.log('📊 RSIを計算中...');
  for (let i = 14; i < candles.length; i++) {
    const recentCandles = candles.slice(Math.max(0, i - 14), i + 1);
    candles[i].rsi = calculateRSI(recentCandles);
  }
  
  // サインを生成（30本に1回）
  console.log('🎯 サインを生成中...');
  const signals = [];
  
  for (let i = 30; i < candles.length; i += 30) {
    const candle = candles[i];
    if (candle.rsi) {
      const signal = generateSignal(candle, i + 1, candle.rsi);
      signals.push(signal);
    }
  }
  
  console.log(`✅ ${signals.length}本のサインを生成しました`);
  
  // SQLを生成
  console.log('📝 SQLファイルを生成中...');
  
  let sql = '-- ローソク足データ\n';
  for (const candle of candles) {
    const rsiValue = candle.rsi ? candle.rsi.toFixed(2) : 'NULL';
    sql += `INSERT INTO gold10_candles (timestamp, open, high, low, close, rsi) VALUES (${candle.timestamp}, ${candle.open.toFixed(2)}, ${candle.high.toFixed(2)}, ${candle.low.toFixed(2)}, ${candle.close.toFixed(2)}, ${rsiValue});\n`;
  }
  
  sql += '\n-- サインデータ\n';
  for (const signal of signals) {
    sql += `INSERT INTO gold10_signals (candle_id, timestamp, type, price, target_price, success, rsi) VALUES (${signal.candle_id}, ${signal.timestamp}, '${signal.type}', ${signal.price.toFixed(2)}, ${signal.target_price.toFixed(2)}, ${signal.success}, ${signal.rsi.toFixed(2)});\n`;
  }
  
  // ファイルに保存
  fs.writeFileSync('historical_data.sql', sql);
  console.log('✅ historical_data.sql に保存しました');
  console.log(`\n次のコマンドでデータベースに適用してください:`);
  console.log(`npx wrangler d1 execute webapp-production --remote --file=historical_data.sql`);
}

generateHistoricalCandles().catch(console.error);
