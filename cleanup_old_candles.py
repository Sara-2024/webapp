#!/usr/bin/env python3
"""
Clean up old candles and keep only the last 120 corrected candles
"""

import subprocess
import sys

def execute_sql(sql_command):
    """Execute SQL command on remote database"""
    cmd = [
        'npx', 'wrangler', 'd1', 'execute', 'webapp-production',
        '--remote', '--command', sql_command
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, cwd='/home/user/webapp')
    
    if result.returncode != 0:
        print(f"❌ Error: {result.stderr}", file=sys.stderr)
        return False
    
    print(result.stdout)
    return True

def main():
    print("🔍 ステップ1: 修正済み直近120本のIDを取得...")
    
    # Get IDs of last 120 candles (corrected ones)
    get_ids_sql = """
    SELECT id FROM gold10_candles 
    ORDER BY timestamp DESC 
    LIMIT 120
    """
    
    print(f"\n実行SQL:\n{get_ids_sql}\n")
    
    if not execute_sql(get_ids_sql):
        print("❌ ID取得に失敗しました")
        return
    
    print("\n" + "=" * 80)
    print("確認: 上記の120本のIDを除き、すべての古いデータを削除します")
    print("=" * 80)
    
    # Delete all old candles except the last 120
    delete_old_sql = """
    DELETE FROM gold10_candles 
    WHERE id NOT IN (
        SELECT id FROM gold10_candles 
        ORDER BY timestamp DESC 
        LIMIT 120
    )
    """
    
    print(f"\n🗑️  ステップ2: 古いデータを削除中...\n")
    print(f"実行SQL:\n{delete_old_sql}\n")
    
    if execute_sql(delete_old_sql):
        print("\n✅ 古いデータの削除完了！")
        
        # Verify
        print("\n📊 ステップ3: データ数を確認中...")
        count_sql = "SELECT COUNT(*) as total FROM gold10_candles"
        execute_sql(count_sql)
    else:
        print("❌ 削除に失敗しました")

if __name__ == '__main__':
    main()
