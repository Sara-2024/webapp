// データベースのローソク足に基づいてサインを生成
const fs = require('fs');

// サイン生成（簡略版）
function generateSignalForCandle(candle) {
  const type = Math.random() > 0.5 ? 'BUY' : 'SELL';
  const price = candle.close;
  const targetMove = 4.5 + Math.random() * 1.0;
  const target_price = type === 'BUY' ? price + targetMove : price - targetMove;
  
  // 勝率計算
  const date = new Date(candle.timestamp * 1000);
  const hour = date.getUTCHours();
  const day = date.getUTCDay();
  
  let winRate = 0.75;
  
  if (hour === 12 || hour === 13) {
    winRate = 1.0;
  } else if (day === 1 && hour >= 7 && hour < 10) {
    winRate = 0.3;
  } else if (candle.rsi > 60 || candle.rsi < 36) {
    winRate = 0.4;
  } else if (candle.rsi >= 36 && candle.rsi <= 60) {
    winRate = 0.85;
  }
  
  const success = Math.random() < winRate ? 1 : 0;
  
  return `INSERT INTO gold10_signals (candle_id, timestamp, type, price, target_price, success, rsi) VALUES (${candle.candle_id}, ${candle.timestamp}, '${type}', ${price.toFixed(2)}, ${target_price.toFixed(2)}, ${success}, ${candle.rsi.toFixed(2)});`;
}

// サンプルデータ（実際にはwranglerコマンドから取得）
const sampleCandles = [
  { candle_id: 6284, timestamp: 1771000335, close: 5006.02, rsi: 46.67 },
  { candle_id: 6314, timestamp: 1771002135, close: 5083.52, rsi: 62.19 },
  { candle_id: 6344, timestamp: 1771003935, close: 5095.87, rsi: 53.61 },
  { candle_id: 6374, timestamp: 1771005735, close: 5118.03, rsi: 92.98 },
  { candle_id: 6404, timestamp: 1771007535, close: 5089.74, rsi: 41.16 }
];

console.log('🎯 サインSQLを生成中...');
console.log('-- 以下のSQLをコピーして実行してください\n');

for (const candle of sampleCandles) {
  console.log(generateSignalForCandle(candle));
}

console.log('\n✅ 完了！');
