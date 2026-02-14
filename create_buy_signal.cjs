const fs = require('fs');

// 現在時刻（UTC）
const now = Math.floor(Date.now() / 1000);

// 最新のローソク足情報を取得（仮の値として設定）
const basePrice = 4748.00; // 最新の終値の近似値
const baseTimestamp = now - (now % 60); // 現在時刻を1分単位に丸める

// 5分間のローソク足を生成（上昇トレンド）
const candles = [];
let currentPrice = basePrice;

for (let i = 0; i < 6; i++) {
  const timestamp = baseTimestamp + (i * 60);
  const open = currentPrice;
  
  // 上昇トレンド：各ローソク足で$5-$10上昇
  const priceMove = 5 + Math.random() * 5;
  const close = open + priceMove;
  const high = close + Math.random() * 2;
  const low = open - Math.random() * 2;
  
  candles.push({
    timestamp,
    open: open.toFixed(2),
    high: high.toFixed(2),
    low: low.toFixed(2),
    close: close.toFixed(2)
  });
  
  currentPrice = close;
}

// 買いサインを5分後（6本目のローソク足）に生成
const signalCandle = candles[5];
const signalPrice = parseFloat(signalCandle.close);
const targetPrice = signalPrice + 5; // $5上昇を目標

// SQL生成
let sql = '-- 5分間の上昇ローソク足\n';
candles.forEach(c => {
  sql += `INSERT INTO gold10_candles (timestamp, open, high, low, close, rsi) VALUES (${c.timestamp}, ${c.open}, ${c.high}, ${c.low}, ${c.close}, 65.5);\n`;
});

sql += '\n-- 買いサイン（5分後）\n';
sql += `INSERT INTO gold10_signals (candle_id, timestamp, type, price, target_price, success, rsi) 
SELECT id, ${signalCandle.timestamp}, 'BUY', ${signalPrice.toFixed(2)}, ${targetPrice.toFixed(2)}, 0, 65.5 
FROM gold10_candles WHERE timestamp = ${signalCandle.timestamp};\n`;

fs.writeFileSync('buy_signal.sql', sql);
console.log('✅ 買いサイン用SQLファイルを作成しました');
console.log(`📊 ローソク足: 6本 (${new Date(baseTimestamp * 1000).toISOString()} から)`);
console.log(`💰 価格推移: $${basePrice} → $${currentPrice.toFixed(2)} (+$${(currentPrice - basePrice).toFixed(2)})`);
console.log(`🔔 買いサイン: ${new Date(signalCandle.timestamp * 1000).toISOString()} @ $${signalPrice.toFixed(2)}`);
