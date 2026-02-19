#!/usr/bin/env python3
"""
Fix last 120 candles to ensure absolute continuity:
1. No wicks: high = max(open, close), low = min(open, close)
2. No gaps: open = previous close
3. Generate SQL to update database
"""

import json
import subprocess
import sys

def get_last_candles(limit=120):
    """Fetch last N candles from remote database"""
    cmd = [
        'npx', 'wrangler', 'd1', 'execute', 'webapp-production',
        '--remote', '--command',
        f'SELECT id, timestamp, open, high, low, close FROM gold10_candles ORDER BY timestamp DESC LIMIT {limit}'
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, cwd='/home/user/webapp')
    
    if result.returncode != 0:
        print(f"❌ Error fetching candles: {result.stderr}", file=sys.stderr)
        sys.exit(1)
    
    # Parse JSON output
    output = result.stdout
    # Find JSON array in output
    start_idx = output.find('[')
    if start_idx == -1:
        print(f"❌ No JSON found in output", file=sys.stderr)
        sys.exit(1)
    
    json_str = output[start_idx:]
    data = json.loads(json_str)
    
    # Extract results
    candles = data[0]['results']
    # Reverse to get chronological order (oldest first)
    candles.reverse()
    return candles

def fix_continuity(candles):
    """Fix candles to ensure continuity and no wicks"""
    updates = []
    errors_found = 0
    
    print("=" * 80)
    print(f"過去{len(candles)}本のローソク足を検証・修正中...")
    print("=" * 80)
    
    for i, candle in enumerate(candles):
        candle_id = candle['id']
        timestamp = candle['timestamp']
        original_open = candle['open']
        original_high = candle['high']
        original_low = candle['low']
        original_close = candle['close']
        
        # Determine correct open (must equal previous close)
        if i == 0:
            # First candle - keep original open
            correct_open = original_open
        else:
            # Must equal previous close
            correct_open = candles[i-1]['close']
        
        # Keep original close (preserve price movement)
        correct_close = original_close
        
        # Remove wicks: high/low must equal open/close
        if correct_close >= correct_open:
            # Bullish candle
            correct_high = correct_close
            correct_low = correct_open
        else:
            # Bearish candle
            correct_high = correct_open
            correct_low = correct_close
        
        # Check if update needed
        needs_update = False
        issues = []
        
        if abs(original_open - correct_open) > 0.01:
            needs_update = True
            issues.append(f"open: {original_open:.2f}→{correct_open:.2f}")
            errors_found += 1
        
        if abs(original_high - correct_high) > 0.01:
            needs_update = True
            issues.append(f"high: {original_high:.2f}→{correct_high:.2f}")
        
        if abs(original_low - correct_low) > 0.01:
            needs_update = True
            issues.append(f"low: {original_low:.2f}→{correct_low:.2f}")
        
        if needs_update:
            print(f"\n🔧 修正 #{i+1} (id={candle_id}, ts={timestamp})")
            print(f"   {', '.join(issues)}")
            
            updates.append({
                'id': candle_id,
                'timestamp': timestamp,
                'open': correct_open,
                'high': correct_high,
                'low': correct_low,
                'close': correct_close
            })
            
            # Update in-memory for next iteration
            candle['open'] = correct_open
            candle['high'] = correct_high
            candle['low'] = correct_low
            candle['close'] = correct_close
    
    print("\n" + "=" * 80)
    print(f"検証完了: {len(updates)}本のローソク足を修正します")
    print(f"ギャップエラー: {errors_found}件")
    print("=" * 80)
    
    return updates

def generate_update_sql(updates, batch_size=50):
    """Generate SQL update statements in batches"""
    sql_files = []
    
    for batch_idx in range(0, len(updates), batch_size):
        batch = updates[batch_idx:batch_idx + batch_size]
        batch_num = batch_idx // batch_size + 1
        
        sql_statements = []
        for u in batch:
            sql = f"""UPDATE gold10_candles 
SET open = {u['open']}, high = {u['high']}, low = {u['low']}, close = {u['close']}
WHERE id = {u['id']};"""
            sql_statements.append(sql)
        
        filename = f"/tmp/fix_candles_batch_{batch_num}.sql"
        with open(filename, 'w') as f:
            f.write('\n'.join(sql_statements))
        
        sql_files.append(filename)
        print(f"✅ バッチ {batch_num} 作成: {filename} ({len(batch)}本)")
    
    return sql_files

def main():
    print("🔍 ステップ1: 直近120本のローソク足を取得中...")
    candles = get_last_candles(120)
    print(f"✅ {len(candles)}本取得完了")
    
    print("\n🔧 ステップ2: 連続性を検証・修正中...")
    updates = fix_continuity(candles)
    
    if len(updates) == 0:
        print("\n✅ すべてのローソク足がルールに適合しています！")
        return
    
    print(f"\n📝 ステップ3: SQL更新文を生成中...")
    sql_files = generate_update_sql(updates)
    
    print(f"\n✅ 完了: {len(sql_files)}個のSQLファイルを生成しました")
    print("\n実行コマンド:")
    for sql_file in sql_files:
        print(f"  npx wrangler d1 execute webapp-production --remote --file={sql_file}")

if __name__ == '__main__':
    main()
