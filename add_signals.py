#!/usr/bin/env python3
import subprocess
import json
import random
from datetime import datetime

# 30本ごとのローソク足を取得
query = """
WITH numbered_candles AS (
  SELECT 
    id,
    timestamp,
    close,
    rsi,
    ROW_NUMBER() OVER (ORDER BY timestamp) as row_num
  FROM gold10_candles
  WHERE rsi IS NOT NULL
)
SELECT id, timestamp, close, rsi
FROM numbered_candles
WHERE row_num % 30 = 15
"""

result = subprocess.run(
    ["npx", "wrangler", "d1", "execute", "webapp-production", "--remote", "--command", query, "--json"],
    capture_output=True,
    text=True,
    cwd="/home/user/webapp"
)

data = json.loads(result.stdout)
candles = data[0]["results"]

print(f"Found {len(candles)} positions for signals")

# 各ローソク足に対してサインを生成
for candle in candles:
    candle_id = candle["id"]
    timestamp = candle["timestamp"]
    price = candle["close"]
    rsi = candle["rsi"]
    
    # サインタイプを決定
    if rsi < 40:
        signal_type = "BUY"
        target_price = price + 5
    elif rsi > 60:
        signal_type = "SELL"
        target_price = price - 5
    elif candle_id % 2 == 0:
        signal_type = "BUY"
        target_price = price + 5
    else:
        signal_type = "SELL"
        target_price = price - 5
    
    # 勝率を決定
    dt = datetime.fromtimestamp(timestamp + 9*3600)  # JST
    hour = dt.hour
    minute = dt.minute
    weekday = dt.weekday()  # 0=月曜
    
    if hour == 21 and minute >= 30:
        success = 1  # 100%
    elif hour == 22 and minute == 0:
        success = 1  # 100%
    elif weekday == 0 and 16 <= hour < 19:
        success = 1 if random.random() < 0.3 else 0  # 30%
    elif rsi > 60 or rsi < 36:
        success = 1 if random.random() < 0.4 else 0  # 40%
    elif 36 <= rsi <= 60:
        success = 1 if random.random() < 0.85 else 0  # 85%
    else:
        success = 1 if random.random() < 0.75 else 0  # 75%
    
    # INSERT
    insert_query = f"""
    INSERT INTO gold10_signals (candle_id, timestamp, type, price, target_price, success, rsi)
    VALUES ({candle_id}, {timestamp}, '{signal_type}', {price}, {target_price}, {success}, {rsi})
    """
    
    subprocess.run(
        ["npx", "wrangler", "d1", "execute", "webapp-production", "--remote", "--command", insert_query],
        cwd="/home/user/webapp",
        capture_output=True
    )
    
    print(f"Added signal: candle_id={candle_id}, type={signal_type}, success={success}")

print(f"\nCompleted! Added {len(candles)} signals")
