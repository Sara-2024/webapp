// GOLD10チャートに初期ローソク足データを投入
const now = Math.floor(Date.now() / 1000);
const base = Math.floor(now / 30) * 30; // 現在の30秒境界

let price = 4950.0;
const candles = [];

// 過去100本のローソク足を生成（50分間）
for (let i = 100; i >= 1; i--) {
  const timestamp = base - (i * 30);
  const open = price;
  
  // ランダムウォーク
  const direction = Math.random() > 0.5 ? 1 : -1;
  const change = direction * (0.1 + Math.random() * 0.3);
  const volatility = 0.05 + Math.random() * 0.1;
  
  const close = open + change + (Math.random() - 0.5) * volatility * 2;
  const high = Math.max(open, close) + Math.random() * 0.5;
  const low = Math.min(open, close) - Math.random() * 0.5;
  
  candles.push({
    timestamp,
    open: open.toFixed(6),
    high: high.toFixed(6),
    low: low.toFixed(6),
    close: close.toFixed(6),
    rsi: 50
  });
  
  price = close;
}

// SQL生成
console.log('-- Generated at:', new Date().toISOString());
console.log('-- Base timestamp:', base, '(', new Date(base * 1000).toISOString(), ')');
console.log('DELETE FROM gold10_candles;');
candles.forEach(c => {
  console.log(`INSERT INTO gold10_candles (timestamp, open, high, low, close, rsi) VALUES (${c.timestamp}, ${c.open}, ${c.high}, ${c.low}, ${c.close}, ${c.rsi});`);
});
