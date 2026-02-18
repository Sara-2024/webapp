#!/usr/bin/env python3
"""
GOLD10 過去720本のローソク足データを生成（ヒゲなし版）
- 連続性: 次のopen = 前のclose（完全一致）
- ヒゲなし: 陽線 high=close/low=open, 陰線 high=open/low=close
- 1本の変動: 最大±6ドル
"""
import json
import random
from datetime import datetime, timedelta

def create_candle(timestamp, open_price, close_price, volume=None):
    """
    ヒゲなしローソク足を生成
    陽線: high=close, low=open
    陰線: high=open, low=close
    同値: high=low=open=close
    """
    if close_price > open_price:
        # 陽線
        high = close_price
        low = open_price
    elif close_price < open_price:
        # 陰線
        high = open_price
        low = close_price
    else:
        # 同値
        high = open_price
        low = open_price
    
    if volume is None:
        volume = random.randint(80, 300)
    
    return {
        'timestamp': int(timestamp.timestamp()),
        'open': round(open_price, 2),
        'high': round(high, 2),
        'low': round(low, 2),
        'close': round(close_price, 2),
        'rsi': 50,
        'volume': volume
    }

def generate_phase1(start_price, start_time, num_candles=180):
    """フェーズ1: レンジ相場（3260-3310）"""
    candles = []
    current_price = start_price
    range_min, range_max = 3260, 3310
    
    for i in range(num_candles):
        timestamp = start_time + timedelta(seconds=i * 30)
        open_price = current_price
        
        # ±2-5ドルの変動
        change = random.uniform(-5, 5)
        close_price = open_price + change
        
        # レンジ内に制限
        close_price = max(range_min, min(range_max, close_price))
        
        # 1本の変動を±6ドル以内に制限
        if abs(close_price - open_price) > 6:
            close_price = open_price + (6 if close_price > open_price else -6)
        
        candles.append(create_candle(timestamp, open_price, close_price))
        current_price = close_price
    
    return candles

def generate_phase2(start_price, start_time, num_candles=80):
    """フェーズ2: 下落（3300 → 3165）"""
    candles = []
    current_price = start_price
    target_price = 3165
    total_drop = current_price - target_price
    
    for i in range(num_candles):
        timestamp = start_time + timedelta(seconds=i * 30)
        open_price = current_price
        
        # 小さな反発を挟む
        if i % 8 == 5:
            change = random.uniform(3, 5)  # 反発
        else:
            # 下落
            remaining = current_price - target_price
            avg_drop = remaining / (num_candles - i)
            change = -avg_drop * random.uniform(0.8, 1.5)
        
        close_price = open_price + change
        close_price = max(3155, close_price)
        
        # 1本の変動を±6ドル以内に制限
        if abs(close_price - open_price) > 6:
            close_price = open_price + (6 if close_price > open_price else -6)
        
        candles.append(create_candle(timestamp, open_price, close_price))
        current_price = close_price
    
    return candles

def generate_phase3(start_price, start_time, num_candles=90):
    """フェーズ3: 底値レンジ〜反発（3165 → 3240）"""
    candles = []
    current_price = start_price
    target_price = 3240
    
    for i in range(num_candles):
        timestamp = start_time + timedelta(seconds=i * 30)
        open_price = current_price
        
        progress = i / num_candles
        if progress < 0.5:
            # 前半: 底値レンジ 3160-3200
            change = random.uniform(-4, 4)
        else:
            # 後半: 上昇開始
            remaining = target_price - current_price
            avg_rise = remaining / (num_candles - i)
            change = avg_rise * random.uniform(0.8, 1.5)
        
        close_price = open_price + change
        close_price = max(3155, min(3250, close_price))
        
        # 1本の変動を±6ドル以内に制限
        if abs(close_price - open_price) > 6:
            close_price = open_price + (6 if close_price > open_price else -6)
        
        candles.append(create_candle(timestamp, open_price, close_price))
        current_price = close_price
    
    return candles

def generate_phase4(start_price, start_time, num_candles=170):
    """フェーズ4: 上昇トレンド（3240 → 3480）"""
    candles = []
    current_price = start_price
    target_price = 3480
    total_rise = target_price - current_price
    
    for i in range(num_candles):
        timestamp = start_time + timedelta(seconds=i * 30)
        open_price = current_price
        
        # 押し目を挟む（25本ごと）
        if i % 25 >= 20 and i % 25 < 25:
            # 押し目（-10〜-20ドルを5本で）
            change = random.uniform(-4, -2)
        else:
            # 上昇
            remaining = target_price - current_price
            avg_rise = remaining / (num_candles - i)
            change = avg_rise * random.uniform(0.8, 1.5)
        
        close_price = open_price + change
        close_price = min(3490, close_price)
        
        # 1本の変動を±6ドル以内に制限
        if abs(close_price - open_price) > 6:
            close_price = open_price + (6 if close_price > open_price else -6)
        
        candles.append(create_candle(timestamp, open_price, close_price))
        current_price = close_price
    
    return candles

def generate_phase5(start_price, start_time, num_candles=60):
    """フェーズ5: ピーク〜下落（3480 → 3370）"""
    candles = []
    current_price = start_price
    target_price = 3370
    
    for i in range(num_candles):
        timestamp = start_time + timedelta(seconds=i * 30)
        open_price = current_price
        
        if i < 15:
            # ダブルトップ形成
            change = random.uniform(-5, 5)
        else:
            # 急下落
            remaining = current_price - target_price
            avg_drop = remaining / (num_candles - i)
            change = -avg_drop * random.uniform(1.0, 1.5)
        
        close_price = open_price + change
        close_price = max(3365, close_price)
        
        # 1本の変動を±6ドル以内に制限
        if abs(close_price - open_price) > 6:
            close_price = open_price + (6 if close_price > open_price else -6)
        
        candles.append(create_candle(timestamp, open_price, close_price))
        current_price = close_price
    
    return candles

def generate_phase6(start_price, start_time, num_candles=140):
    """フェーズ6: 下落継続〜現在値（3370 → 3291.07）"""
    candles = []
    current_price = start_price
    target_price = 3291.07
    
    for i in range(num_candles):
        timestamp = start_time + timedelta(seconds=i * 30)
        open_price = current_price
        
        # 反発を挟む
        if (30 <= i <= 40) or (80 <= i <= 90):
            # 反発（3320-3340へ）
            change = random.uniform(2, 5)
        else:
            # じわ下げ
            remaining = current_price - target_price
            avg_drop = remaining / (num_candles - i)
            change = -avg_drop * random.uniform(0.7, 1.2)
        
        close_price = open_price + change
        
        # 最終値に収束
        if i == num_candles - 1:
            close_price = target_price
        
        # 1本の変動を±6ドル以内に制限
        if abs(close_price - open_price) > 6:
            close_price = open_price + (6 if close_price > open_price else -6)
        
        candles.append(create_candle(timestamp, open_price, close_price))
        current_price = close_price
    
    return candles

def main():
    # 開始時刻: 2026-02-18 08:07:00 UTC
    start_time = datetime(2026, 2, 18, 8, 7, 0)
    
    print("フェーズ1: レンジ相場 (180本) 生成中...")
    phase1 = generate_phase1(3280.00, start_time, 180)
    
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
    
    # 連続性チェック
    print("\n連続性チェック中...")
    errors = 0
    for i in range(1, len(all_candles)):
        prev_close = all_candles[i-1]['close']
        curr_open = all_candles[i]['open']
        if prev_close != curr_open:
            print(f"❌ エラー {i}本目: 前close={prev_close} ≠ 現open={curr_open}")
            errors += 1
    
    if errors == 0:
        print("✅ 全ローソク足の連続性OK")
    else:
        print(f"⚠️ {errors}個のエラーが見つかりました")
    
    # ヒゲなしチェック
    print("\nヒゲなしチェック中...")
    hige_errors = 0
    for i, c in enumerate(all_candles):
        if c['close'] > c['open']:
            # 陽線: high=close, low=open
            if c['high'] != c['close'] or c['low'] != c['open']:
                print(f"❌ {i+1}本目（陽線）: high={c['high']} (期待={c['close']}), low={c['low']} (期待={c['open']})")
                hige_errors += 1
        elif c['close'] < c['open']:
            # 陰線: high=open, low=close
            if c['high'] != c['open'] or c['low'] != c['close']:
                print(f"❌ {i+1}本目（陰線）: high={c['high']} (期待={c['open']}), low={c['low']} (期待={c['close']})")
                hige_errors += 1
        else:
            # 同値
            if c['high'] != c['open'] or c['low'] != c['open']:
                print(f"❌ {i+1}本目（同値）: high={c['high']}, low={c['low']} (期待={c['open']})")
                hige_errors += 1
    
    if hige_errors == 0:
        print("✅ 全ローソク足がヒゲなし")
    else:
        print(f"⚠️ {hige_errors}個のヒゲエラーが見つかりました")
    
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

if __name__ == '__main__':
    main()
