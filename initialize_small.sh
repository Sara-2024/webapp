#!/bin/bash
# 少量の初期データを生成（120本 = 2時間分）

echo "🚀 初期データ生成を開始します（120本のローソク足）"

# /api/gold10/generateを120回呼び出す
for i in {1..120}; do
  echo -n "."
  curl -s https://8c4f2568.webapp-303.pages.dev/api/gold10/generate > /dev/null
  sleep 0.1
done

echo ""
echo "✅ 完了！120本のローソク足を生成しました"
