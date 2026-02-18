#!/usr/bin/env python3
"""
GOLD10 過去720本のローソク足データを生成してデータベースに投入
"""
import json
import subprocess
from datetime import datetime, timedelta
import random

def generate_phase1(start_price, start_time, num_candles=180):
    """フェーズ1: レンジ相場（3260-3310）"""
    candles = []
    current_price = start_price
    range_min, range_max = 3260, 3310
    
    for i in range(num_candles):
        timestamp = int(start_time.timestamp()) + i * 30
        open_price = current_price + (random.random() - 0.5) * 2
        
        change = (random.random() - 0.5) * 5
        close_price = max(range_min, min(range_max, open_price + change))
        
        volatility = 2 + random.random() * 3
        high = max(open_price, close_price) + random.random() * volatility
        low = min(open_price, close_price) - random.random() * volatility
        
        candles.append({
            'timestamp': timestamp,
            'open': round(open_price, 2),
            'high': round(high, 2),
            'low': round(low, 2),
            'close': round(close_price, 2),
            'rsi': 50
        })
        
        current_price = close_price
    
    return candles

def generate_phase2(start_price, start_time, num_candles=80):
    """フェーズ2: 下落（3300 → 3165）"""
    candles = []
    current_price = start_price
    target_price = 3165
    total_drop = current_price - target_price
    
    for i in range(num_candles):
        timestamp = int(start_time.timestamp()) + i * 30
        open_price = current_price + (random.random() - 0.5) * 2
        
        # 小さな反発を挟む
        if i % 15 == 10:
            change = 5 + random.random() * 10
        else:
            change = -(total_drop / num_candles) * (1 + random.random() * 0.5)
        
        close_price = max(3155, open_price + change)
        
        volatility = 5 + random.random() * 10
        high = max(open_price, close_price) + random.random() * volatility * 0.3
        low = min(open_price, close_price) - random.random() * volatility
        
        candles.append({
            'timestamp': timestamp,
            'open': round(open_price, 2),
            'high': round(high, 2),
            'low': round(low, 2),
            'close': round(close_price, 2),
            'rsi': 50
        })
        
        current_price = close_price
    
    return candles

def generate_phase3(start_price, start_time, num_candles=90):
    """フェーズ3: 底値レンジ〜反発（3165 → 3240）"""
    candles = []
    current_price = start_price
    target_price = 3240
    
    for i in range(num_candles):
        timestamp = int(start_time.timestamp()) + i * 30
        open_price = current_price + (random.random() - 0.5) * 2
        
        progress = i / num_candles
        if progress < 0.5:
            # 底値レンジ
            change = (random.random() - 0.5) * 8
        else:
            # 上昇開始
            change = (target_price - current_price) / (num_candles - i) + (random.random() - 0.3) * 5
        
        close_price = max(3155, min(3250, open_price + change))
        
        volatility = 3 + random.random() * 7
        high = max(open_price, close_price) + random.random() * volatility * 0.5
        low = min(open_price, close_price) - random.random() * volatility * 0.5
        
        candles.append({
            'timestamp': timestamp,
            'open': round(open_price, 2),
            'high': round(high, 2),
            'low': round(low, 2),
            'close': round(close_price, 2),
            'rsi': 50
        })
        
        current_price = close_price
    
    return candles

def generate_phase4(start_price, start_time, num_candles=170):
    """フェーズ4: 上昇トレンド（3240 → 3400）"""
    candles = []
    current_price = start_price
    target_price = 3400  # より保守的に
    total_rise = target_price - current_price
    
    for i in range(num_candles):
        timestamp = int(start_time.timestamp()) + i * 30
        open_price = current_price + (random.random() - 0.5) * 2
        
        # 押し目を挟む
        if i % 40 == 30:
            change = -(10 + random.random() * 10)
        else:
            change = (total_rise / num_candles) * (1.0 + random.random() * 0.3)
        
        close_price = min(3400, open_price + change)
        
        volatility = 5 + random.random() * 6
        high = min(3450, max(open_price, close_price) + random.random() * volatility * 0.2)
        low = max(3100, min(open_price, close_price) - random.random() * volatility * 0.1)
        
        candles.append({
            'timestamp': timestamp,
            'open': round(open_price, 2),
            'high': round(high, 2),
            'low': round(low, 2),
            'close': round(close_price, 2),
            'rsi': 50
        })
        
        current_price = close_price
    
    return candles

def generate_phase5(start_price, start_time, num_candles=60):
    """フェーズ5: ピーク〜下落（3400 → 3370）"""
    candles = []
    current_price = start_price
    target_price = 3370
    
    for i in range(num_candles):
        timestamp = int(start_time.timestamp()) + i * 30
        open_price = current_price + (random.random() - 0.5) * 2
        
        if i < 15:
            # ダブルトップ
            change = (random.random() - 0.5) * 10
        else:
            # 急下落
            total_drop = current_price - target_price
            change = -(total_drop / (num_candles - i)) * (1 + random.random() * 0.3)
        
        close_price = max(3365, open_price + change)
        
        volatility = 8 + random.random() * 12
        high = min(3480, max(open_price, close_price) + random.random() * volatility * 0.15)
        low = max(3100, min(open_price, close_price) - random.random() * volatility * 0.5)
        
        candles.append({
            'timestamp': timestamp,
            'open': round(open_price, 2),
            'high': round(high, 2),
            'low': round(low, 2),
            'close': round(close_price, 2),
            'rsi': 50
        })
        
        current_price = close_price
    
    return candles

def generate_phase6(start_price, start_time, num_candles=140):
    """フェーズ6: 下落継続〜現在値（3370 → 3291.07）"""
    candles = []
    current_price = start_price
    target_price = 3291.07
    
    for i in range(num_candles):
        timestamp = int(start_time.timestamp()) + i * 30
        open_price = current_price + (random.random() - 0.5) * 2
        
        # 反発を挟む
        if (30 <= i <= 40) or (80 <= i <= 90):
            change = 10 + random.random() * 15
        else:
            remaining = current_price - target_price
            change = -(remaining / (num_candles - i)) * (0.8 + random.random() * 0.4)
        
        close_price = open_price + change
        
        # 最終値に収束
        if i == num_candles - 1:
            close_price = target_price
        
        volatility = 5 + random.random() * 10
        high = max(open_price, close_price) + random.random() * volatility * 0.3
        low = min(open_price, close_price) - random.random() * volatility * 0.4
        
        candles.append({
            'timestamp': timestamp,
            'open': round(open_price, 2),
            'high': round(high, 2),
            'low': round(low, 2),
            'close': round(close_price, 2),
            'rsi': 50
        })
        
        current_price = close_price
    
    return candles

def main():
    # 開始時刻: 2026-02-18 08:00:00 UTC
    start_time = datetime(2026, 2, 18, 8, 0, 0)
    
    print("フェーズ1: レンジ相場 (180本) 生成中...")
    phase1 = generate_phase1(3280, start_time, 180)
    
    print("フェーズ2: 下落 (80本) 生成中...")
    phase2_start = start_time + timedelta(seconds=180 * 30)
    phase2 = generate_phase2(phase1[-1]['close'], phase2_start, 80)
    
    print("フェーズ3: 底値〜反発 (90本) 生成中...")
    phase3_start = phase2_start + timedelta(seconds=80 * 30)
    phase3 = generate_phase3(phase2[-1]['close'], phase3_start, 90)
    
    print("フェーズ4: 上昇トレンド (170本) 生成中...")
    phase4_start = phase3_start + timedelta(seconds=90 * 30)
    phase4 = generate_phase4(phase3[-1]['close'], phase4_start, 170)
    
    print("フェーズ5: ピーク〜下落 (60本) 生成中...")
    phase5_start = phase4_start + timedelta(seconds=170 * 30)
    phase5 = generate_phase5(phase4[-1]['close'], phase5_start, 60)
    
    print("フェーズ6: 下落継続 (140本) 生成中...")
    phase6_start = phase5_start + timedelta(seconds=60 * 30)
    phase6 = generate_phase6(phase5[-1]['close'], phase6_start, 140)
    
    all_candles = phase1 + phase2 + phase3 + phase4 + phase5 + phase6
    
    # 全データを3100-3500の範囲にクリッピング
    for candle in all_candles:
        candle['open'] = max(3100, min(3500, candle['open']))
        candle['high'] = max(3100, min(3500, candle['high']))
        candle['low'] = max(3100, min(3500, candle['low']))
        candle['close'] = max(3100, min(3500, candle['close']))
    
    print(f"\n合計: {len(all_candles)} 本")
    print(f"開始価格: {all_candles[0]['open']}")
    print(f"最終価格: {all_candles[-1]['close']}")
    print(f"最高値: {max(c['high'] for c in all_candles)}")
    print(f"最安値: {min(c['low'] for c in all_candles)}")
    
    # SQL生成（50本ずつ分割）
    batch_size = 50
    sql_files = []
    
    for batch_num in range(0, len(all_candles), batch_size):
        batch = all_candles[batch_num:batch_num + batch_size]
        values = []
        for c in batch:
            values.append(f"({c['timestamp']}, {c['open']}, {c['high']}, {c['low']}, {c['close']}, {c['rsi']})")
        
        sql = f"INSERT INTO gold10_candles (timestamp, open, high, low, close, rsi) VALUES {', '.join(values)};"
        
        filename = f"/tmp/insert_batch_{batch_num // batch_size + 1}.sql"
        with open(filename, 'w') as f:
            f.write(sql)
        
        sql_files.append(filename)
        print(f"バッチ {batch_num // batch_size + 1}/{(len(all_candles) + batch_size - 1) // batch_size}: {filename}")
    
    print(f"\n生成したSQLファイル: {len(sql_files)} 個")
    print("実行コマンド:")
    for sql_file in sql_files:
        print(f'  npx wrangler d1 execute webapp-production --remote --file={sql_file}')

if __name__ == '__main__':
    main()
