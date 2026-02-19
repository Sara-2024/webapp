#!/usr/bin/env python3
"""
Verify candle data follows strict rules:
1. No wicks: high = max(open, close), low = min(open, close)
2. No gaps: open = previous close
"""

candles = [
    {"timestamp": 1771501080, "open": 4137.671943150447, "high": 4143.5754333996765, "low": 4135.240105390512, "close": 4140.539134046127},
    {"timestamp": 1771501140, "open": 4140.539134046127, "high": 4144.720706580417, "low": 4138.160178228872, "close": 4143.76825464045},
    {"timestamp": 1771501200, "open": 4143.76825464045, "high": 4155.945837973851, "low": 4141.7692277015085, "close": 4155.160398836689},
    {"timestamp": 1771501260, "open": 4155.160398836689, "high": 4161.871059617007, "low": 4152.451493955992, "close": 4157.662891456889},
    {"timestamp": 1771501320, "open": 4157.662891456889, "high": 4168.997677704455, "low": 4156.693751965344, "close": 4164.655015368883},
    {"timestamp": 1771501380, "open": 4164.655015368883, "high": 4173.950140941191, "low": 4163.505785099687, "close": 4170.170708459133},
    {"timestamp": 1771501440, "open": 4170.170708459133, "high": 4179.4809828713705, "low": 4168.327354418539, "close": 4175.397377636392},
    {"timestamp": 1771501500, "open": 4175.397377636392, "high": 4179.611744176471, "low": 4172.794462557313, "close": 4177.889984862448},
    {"timestamp": 1771501560, "open": 4177.889984862448, "high": 4178.46360016017, "low": 4171.349198440579, "close": 4175.128703263298},
    {"timestamp": 1771501620, "open": 4175.128703263298, "high": 4176.186593331689, "low": 4168.1150203642665, "close": 4168.629104739183},
]

print("=" * 80)
print("ローソク足検証（最新10本）")
print("=" * 80)

errors_found = False

for i, candle in enumerate(candles):
    ts = candle["timestamp"]
    o, h, l, c = candle["open"], candle["high"], candle["low"], candle["close"]
    
    print(f"\n#{i+1} timestamp={ts}")
    print(f"  open={o:.2f}, high={h:.2f}, low={l:.2f}, close={c:.2f}")
    
    # Check wicks
    expected_high = max(o, c)
    expected_low = min(o, c)
    
    has_wick = False
    if abs(h - expected_high) > 0.01:
        print(f"  ❌ WICK ERROR: high={h:.2f} but expected {expected_high:.2f} (max of open/close)")
        has_wick = True
        errors_found = True
    
    if abs(l - expected_low) > 0.01:
        print(f"  ❌ WICK ERROR: low={l:.2f} but expected {expected_low:.2f} (min of open/close)")
        has_wick = True
        errors_found = True
    
    if not has_wick:
        print(f"  ✅ No wick")
    
    # Check gap (continuity)
    if i > 0:
        prev_close = candles[i-1]["close"]
        gap = abs(o - prev_close)
        if gap > 0.01:
            print(f"  ❌ GAP ERROR: open={o:.2f} but prev close={prev_close:.2f} (gap={gap:.2f})")
            errors_found = True
        else:
            print(f"  ✅ Continuity OK (open = prev close)")

print("\n" + "=" * 80)
if errors_found:
    print("❌ ルール違反が検出されました！")
else:
    print("✅ すべてのルールが守られています")
print("=" * 80)
