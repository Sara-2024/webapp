// 過去のローソク足データに基づいてサインを生成するスクリプト
// 30本に1回の頻度でサインを配置

const generateSignalsSQL = `
WITH numbered_candles AS (
  SELECT 
    id,
    timestamp,
    close,
    rsi,
    ROW_NUMBER() OVER (ORDER BY timestamp) as row_num
  FROM gold10_candles
  WHERE rsi IS NOT NULL
),
signal_positions AS (
  SELECT 
    id,
    timestamp,
    close,
    rsi,
    row_num
  FROM numbered_candles
  WHERE row_num % 30 = 15  -- 30本ごとの15番目（ちょうど中間）
)
SELECT 
  id as candle_id,
  timestamp,
  close as price,
  rsi,
  CASE 
    WHEN rsi < 40 THEN 'BUY'
    WHEN rsi > 60 THEN 'SELL'
    WHEN (id % 2) = 0 THEN 'BUY'
    ELSE 'SELL'
  END as type,
  CASE 
    WHEN rsi < 40 THEN close + 5
    WHEN rsi > 60 THEN close - 5
    WHEN (id % 2) = 0 THEN close + 5
    ELSE close - 5
  END as target_price,
  CASE
    -- 21:30-22:00は必ず勝つ
    WHEN strftime('%H', datetime(timestamp, 'unixepoch', '+9 hours')) = '21' 
      AND CAST(strftime('%M', datetime(timestamp, 'unixepoch', '+9 hours')) AS INTEGER) >= 30 THEN 1
    WHEN strftime('%H', datetime(timestamp, 'unixepoch', '+9 hours')) = '22'
      AND strftime('%M', datetime(timestamp, 'unixepoch', '+9 hours')) = '00' THEN 1
    -- 月曜16:00-19:00は負けやすい
    WHEN CAST(strftime('%w', datetime(timestamp, 'unixepoch', '+9 hours')) AS INTEGER) = 1
      AND CAST(strftime('%H', datetime(timestamp, 'unixepoch', '+9 hours')) AS INTEGER) >= 16
      AND CAST(strftime('%H', datetime(timestamp, 'unixepoch', '+9 hours')) AS INTEGER) < 19 THEN
      CASE WHEN (RANDOM() % 100) < 30 THEN 1 ELSE 0 END
    -- RSI > 60 または RSI < 36 は負けやすい
    WHEN rsi > 60 OR rsi < 36 THEN
      CASE WHEN (RANDOM() % 100) < 40 THEN 1 ELSE 0 END
    -- RSI 36-60 は勝ちやすい
    WHEN rsi >= 36 AND rsi <= 60 THEN
      CASE WHEN (RANDOM() % 100) < 85 THEN 1 ELSE 0 END
    -- 基本勝率75%
    ELSE
      CASE WHEN (RANDOM() % 100) < 75 THEN 1 ELSE 0 END
  END as success
FROM signal_positions;
`;

console.log(generateSignalsSQL);
console.log('\n\n--- 実行手順 ---');
console.log('1. 上記のSQLを使用してサインデータを取得');
console.log('2. 各行をINSERT文に変換してgold10_signalsテーブルに挿入');
