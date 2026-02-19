#!/bin/bash
# Continuous cleanup of bad candles for 5 minutes

echo "Starting continuous cleanup (5 minutes)..."
END_TIME=$(($(date +%s) + 300))

while [ $(date +%s) -lt $END_TIME ]; do
    echo "[$(date +%H:%M:%S)] Checking for bad candles..."
    
    cd /home/user/webapp && python3 << 'EOF'
import subprocess
import json

cmd = ['npx', 'wrangler', 'd1', 'execute', 'webapp-production', '--remote', '--command',
       'SELECT id, timestamp, open, high, low, close FROM gold10_candles ORDER BY timestamp ASC']
result = subprocess.run(cmd, capture_output=True, text=True)
start_idx = result.stdout.find('[')
data = json.loads(result.stdout[start_idx:])
candles = data[0]['results']

bad_ids = []
for i, c in enumerate(candles):
    o, h, l, cl = c['open'], c['high'], c['low'], c['close']
    expected_high = max(o, cl)
    expected_low = min(o, cl)
    has_wick = abs(h - expected_high) > 0.01 or abs(l - expected_low) > 0.01
    has_gap = i > 0 and abs(o - candles[i-1]['close']) > 0.01
    
    if has_wick or has_gap:
        bad_ids.append(c['id'])

if bad_ids:
    print(f'Deleting {len(bad_ids)} bad candles...')
    id_list = ','.join([str(i) for i in bad_ids])
    cmd = ['npx', 'wrangler', 'd1', 'execute', 'webapp-production', '--remote', '--command',
           f'DELETE FROM gold10_candles WHERE id IN ({id_list})']
    subprocess.run(cmd, capture_output=True)
    print('Done')
else:
    print('All candles are OK')
EOF
    
    sleep 10
done

echo "Cleanup completed"
