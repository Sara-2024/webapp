/**
 * GOLD10 過去データ生成スクリプト
 * 720本の30秒足ローソク足を生成（約6時間分）
 */

// フェーズ1: レンジ相場（1-180本 / 90分）
function generatePhase1(startPrice, startTime) {
  const candles = [];
  let currentPrice = startPrice; // 3280
  const rangeMin = 3260;
  const rangeMax = 3310;
  
  for (let i = 0; i < 180; i++) {
    const time = new Date(startTime.getTime() + i * 30000).toISOString();
    const open = currentPrice + (Math.random() - 0.5) * 2;
    
    // レンジ内での小さな変動
    const direction = Math.random() - 0.5;
    const change = direction * (2 + Math.random() * 3); // ±2-5ドル
    let close = open + change;
    
    // レンジ内に収める
    close = Math.max(rangeMin, Math.min(rangeMax, close));
    
    const volatility = 2 + Math.random() * 3; // 2-5ドル
    const high = Math.max(open, close) + Math.random() * volatility;
    const low = Math.min(open, close) - Math.random() * volatility;
    
    const volume = Math.floor(80 + Math.random() * 120);
    
    candles.push({
      time,
      open: parseFloat(open.toFixed(2)),
      high: parseFloat(high.toFixed(2)),
      low: parseFloat(low.toFixed(2)),
      close: parseFloat(close.toFixed(2)),
      volume
    });
    
    currentPrice = close;
  }
  
  return candles;
}

// フェーズ2: 下落（181-260本 / 40分）
function generatePhase2(startPrice, startTime) {
  const candles = [];
  let currentPrice = startPrice; // 約3300
  const targetPrice = 3165; // 最安値
  const numCandles = 80;
  const totalDrop = currentPrice - targetPrice; // 約135ドル
  
  for (let i = 0; i < numCandles; i++) {
    const time = new Date(startTime.getTime() + i * 30000).toISOString();
    const open = currentPrice + (Math.random() - 0.5) * 2;
    
    // 下落トレンド + 小さな反発
    const progress = i / numCandles;
    let dropAmount;
    
    if (i % 15 === 10) {
      // 小さな反発
      dropAmount = 5 + Math.random() * 10; // 上昇
    } else {
      dropAmount = -(totalDrop / numCandles) * (1 + Math.random() * 0.5);
    }
    
    let close = open + dropAmount;
    close = Math.max(3155, close); // 最安値制限
    
    const volatility = 5 + Math.random() * 10;
    const high = Math.max(open, close) + Math.random() * volatility * 0.3;
    const low = Math.min(open, close) - Math.random() * volatility;
    
    const volume = Math.floor(100 + Math.random() * 150);
    
    candles.push({
      time,
      open: parseFloat(open.toFixed(2)),
      high: parseFloat(high.toFixed(2)),
      low: parseFloat(low.toFixed(2)),
      close: parseFloat(close.toFixed(2)),
      volume
    });
    
    currentPrice = close;
  }
  
  return candles;
}

// フェーズ3: 底値レンジ〜反発開始（261-350本 / 45分）
function generatePhase3(startPrice, startTime) {
  const candles = [];
  let currentPrice = startPrice; // 約3165
  const numCandles = 90;
  const targetPrice = 3240;
  
  for (let i = 0; i < numCandles; i++) {
    const time = new Date(startTime.getTime() + i * 30000).toISOString();
    const open = currentPrice + (Math.random() - 0.5) * 2;
    
    const progress = i / numCandles;
    let change;
    
    if (progress < 0.5) {
      // 前半：底値レンジ 3160-3200
      change = (Math.random() - 0.5) * 8;
    } else {
      // 後半：徐々に上昇
      change = (targetPrice - currentPrice) / (numCandles - i) + (Math.random() - 0.3) * 5;
    }
    
    let close = open + change;
    close = Math.max(3155, Math.min(3250, close));
    
    const volatility = 3 + Math.random() * 7;
    const high = Math.max(open, close) + Math.random() * volatility * 0.5;
    const low = Math.min(open, close) - Math.random() * volatility * 0.5;
    
    // 300本目付近でボリューム増加（買いサイン想定）
    let volume;
    if (i >= 35 && i <= 45) {
      volume = Math.floor(200 + Math.random() * 200);
    } else {
      volume = Math.floor(90 + Math.random() * 130);
    }
    
    candles.push({
      time,
      open: parseFloat(open.toFixed(2)),
      high: parseFloat(high.toFixed(2)),
      low: parseFloat(low.toFixed(2)),
      close: parseFloat(close.toFixed(2)),
      volume
    });
    
    currentPrice = close;
  }
  
  return candles;
}

// フェーズ4: 上昇トレンド（351-520本 / 85分）
function generatePhase4(startPrice, startTime) {
  const candles = [];
  let currentPrice = startPrice; // 約3240
  const numCandles = 170;
  const targetPrice = 3480;
  const totalRise = targetPrice - currentPrice; // 約240ドル
  
  for (let i = 0; i < numCandles; i++) {
    const time = new Date(startTime.getTime() + i * 30000).toISOString();
    const open = currentPrice + (Math.random() - 0.5) * 2;
    
    // 押し目を挟む（40本ごと）
    let change;
    if (i % 40 === 30) {
      // 押し目
      change = -(10 + Math.random() * 10);
    } else {
      // 上昇
      change = (totalRise / numCandles) * (1.2 + Math.random() * 0.5);
    }
    
    let close = open + change;
    close = Math.min(3485, close); // ピーク制限
    
    const volatility = 10 + Math.random() * 15;
    const high = Math.max(open, close) + Math.random() * volatility * 0.4;
    const low = Math.min(open, close) - Math.random() * volatility * 0.2;
    
    const volume = Math.floor(120 + Math.random() * 180);
    
    candles.push({
      time,
      open: parseFloat(open.toFixed(2)),
      high: parseFloat(high.toFixed(2)),
      low: parseFloat(low.toFixed(2)),
      close: parseFloat(close.toFixed(2)),
      volume
    });
    
    currentPrice = close;
  }
  
  return candles;
}

// フェーズ5: ピーク〜下落開始（521-580本 / 30分）
function generatePhase5(startPrice, startTime) {
  const candles = [];
  let currentPrice = startPrice; // 約3480
  const numCandles = 60;
  const targetPrice = 3370;
  
  for (let i = 0; i < numCandles; i++) {
    const time = new Date(startTime.getTime() + i * 30000).toISOString();
    const open = currentPrice + (Math.random() - 0.5) * 2;
    
    let change;
    if (i < 15) {
      // ダブルトップ形成
      change = (Math.random() - 0.5) * 10;
    } else {
      // 急角度の下落
      const totalDrop = currentPrice - targetPrice;
      change = -(totalDrop / (numCandles - i)) * (1 + Math.random() * 0.3);
    }
    
    let close = open + change;
    close = Math.max(3365, close);
    
    const volatility = 10 + Math.random() * 15;
    const high = Math.max(open, close) + Math.random() * volatility * 0.2;
    const low = Math.min(open, close) - Math.random() * volatility * 0.6;
    
    // 540本目付近（i=19付近）でボリューム増加（売りサイン）
    let volume;
    if (i >= 15 && i <= 25) {
      volume = Math.floor(200 + Math.random() * 200);
    } else {
      volume = Math.floor(120 + Math.random() * 150);
    }
    
    candles.push({
      time,
      open: parseFloat(open.toFixed(2)),
      high: parseFloat(high.toFixed(2)),
      low: parseFloat(low.toFixed(2)),
      close: parseFloat(close.toFixed(2)),
      volume
    });
    
    currentPrice = close;
  }
  
  return candles;
}

// フェーズ6: 下落継続〜現在値（581-720本 / 70分）
function generatePhase6(startPrice, startTime) {
  const candles = [];
  let currentPrice = startPrice; // 約3370
  const numCandles = 140;
  const targetPrice = 3291.07; // 最終値
  
  for (let i = 0; i < numCandles; i++) {
    const time = new Date(startTime.getTime() + i * 30000).toISOString();
    const open = currentPrice + (Math.random() - 0.5) * 2;
    
    let change;
    // 2回の反発を挟む
    if ((i >= 30 && i <= 40) || (i >= 80 && i <= 90)) {
      // 反発（3320-3340へ）
      change = 10 + Math.random() * 15;
    } else {
      // じわじわ下落
      const remaining = currentPrice - targetPrice;
      change = -(remaining / (numCandles - i)) * (0.8 + Math.random() * 0.4);
    }
    
    let close = open + change;
    
    // 最終値に収束
    if (i === numCandles - 1) {
      close = targetPrice;
    }
    
    const volatility = 5 + Math.random() * 10;
    const high = Math.max(open, close) + Math.random() * volatility * 0.3;
    const low = Math.min(open, close) - Math.random() * volatility * 0.4;
    
    const volume = Math.floor(90 + Math.random() * 140);
    
    candles.push({
      time,
      open: parseFloat(open.toFixed(2)),
      high: parseFloat(high.toFixed(2)),
      low: parseFloat(low.toFixed(2)),
      close: parseFloat(close.toFixed(2)),
      volume
    });
    
    currentPrice = close;
  }
  
  return candles;
}

// RSI計算
function calculateRSI(candles, period = 14) {
  if (candles.length < period) return 50;
  
  const changes = [];
  for (let i = 1; i < candles.length; i++) {
    changes.push(candles[i].close - candles[i - 1].close);
  }
  
  const recentChanges = changes.slice(-period);
  const gains = recentChanges.filter(c => c > 0).reduce((a, b) => a + b, 0) / period;
  const losses = Math.abs(recentChanges.filter(c => c < 0).reduce((a, b) => a + b, 0)) / period;
  
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

// メイン生成関数
function generateHistoricalData() {
  const startTime = new Date('2026-02-18T08:00:00.000Z');
  const allCandles = [];
  
  console.log('フェーズ1: レンジ相場（1-180本）生成中...');
  const phase1 = generatePhase1(3280, new Date(startTime.getTime()));
  allCandles.push(...phase1);
  
  console.log('フェーズ2: 下落（181-260本）生成中...');
  const phase2Start = new Date(startTime.getTime() + 180 * 30000);
  const phase2 = generatePhase2(phase1[phase1.length - 1].close, phase2Start);
  allCandles.push(...phase2);
  
  console.log('フェーズ3: 底値レンジ〜反発（261-350本）生成中...');
  const phase3Start = new Date(startTime.getTime() + 260 * 30000);
  const phase3 = generatePhase3(phase2[phase2.length - 1].close, phase3Start);
  allCandles.push(...phase3);
  
  console.log('フェーズ4: 上昇トレンド（351-520本）生成中...');
  const phase4Start = new Date(startTime.getTime() + 350 * 30000);
  const phase4 = generatePhase4(phase3[phase3.length - 1].close, phase4Start);
  allCandles.push(...phase4);
  
  console.log('フェーズ5: ピーク〜下落開始（521-580本）生成中...');
  const phase5Start = new Date(startTime.getTime() + 520 * 30000);
  const phase5 = generatePhase5(phase4[phase4.length - 1].close, phase5Start);
  allCandles.push(...phase5);
  
  console.log('フェーズ6: 下落継続〜現在値（581-720本）生成中...');
  const phase6Start = new Date(startTime.getTime() + 580 * 30000);
  const phase6 = generatePhase6(phase5[phase5.length - 1].close, phase6Start);
  allCandles.push(...phase6);
  
  // RSI計算
  console.log('RSI計算中...');
  for (let i = 0; i < allCandles.length; i++) {
    const rsi = calculateRSI(allCandles.slice(0, i + 1), 14);
    allCandles[i].rsi = parseFloat(rsi.toFixed(2));
  }
  
  console.log(`合計 ${allCandles.length} 本のローソク足を生成しました`);
  console.log(`開始価格: ${allCandles[0].open}`);
  console.log(`最終価格: ${allCandles[allCandles.length - 1].close}`);
  console.log(`最高値: ${Math.max(...allCandles.map(c => c.high))}`);
  console.log(`最安値: ${Math.min(...allCandles.map(c => c.low))}`);
  
  return allCandles;
}

// Node.js環境で実行
if (typeof module !== 'undefined' && module.exports) {
  const fs = require('fs');
  const candles = generateHistoricalData();
  
  // JSONファイルに保存
  fs.writeFileSync(
    '/home/user/webapp/historical_candles.json',
    JSON.stringify(candles, null, 2)
  );
  
  console.log('データを historical_candles.json に保存しました');
}
