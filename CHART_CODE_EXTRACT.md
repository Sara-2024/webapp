# GOLD10 チャート構成コード抽出

## 📊 目次
1. [ユーザー側チャート初期化](#ユーザー側チャート初期化)
2. [管理者側チャート初期化](#管理者側チャート初期化)
3. [チャートデータ取得](#チャートデータ取得)
4. [サインマーカー表示](#サインマーカー表示)
5. [リアルタイム更新（ポーリング）](#リアルタイム更新ポーリング)
6. [MACD計算](#macd計算)
7. [RSI表示](#rsi表示)

---

## ユーザー側チャート初期化

### チャート初期化関数
```javascript
function initializeCharts() {
    const chartContainer = document.getElementById('chartContainer');
    const macdContainer = document.getElementById('macdContainer');

    // メインチャート（ローソク足）
    chart = LightweightCharts.createChart(chartContainer, {
        width: chartContainer.clientWidth,
        height: 400,
        layout: {
            background: { color: '#ffffff' },
            textColor: '#333',
        },
        grid: {
            vertLines: { color: '#f0f0f0' },
            horzLines: { color: '#f0f0f0' },
        },
        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal,
        },
        rightPriceScale: {
            borderColor: '#cccccc',
            scaleMargins: {
                top: 0.1,
                bottom: 0.1,
            },
        },
        timeScale: {
            borderColor: '#cccccc',
            timeVisible: true,
            secondsVisible: false,
        },
        localization: {
            timeFormatter: (timestamp) => {
                const date = new Date(timestamp * 1000);
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                const hours = String(date.getHours()).padStart(2, '0');
                const minutes = String(date.getMinutes()).padStart(2, '0');
                return `${month}/${day} ${hours}:${minutes}`;
            }
        }
    });

    // ローソク足シリーズ
    candlestickSeries = chart.addCandlestickSeries({
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderUpColor: '#26a69a',
        borderDownColor: '#ef5350',
        wickUpColor: '#26a69a',
        wickDownColor: '#ef5350',
    });

    // MACDチャート
    macdChart = LightweightCharts.createChart(macdContainer, {
        width: macdContainer.clientWidth,
        height: 150,
        layout: {
            background: { color: '#ffffff' },
            textColor: '#333',
        },
        grid: {
            vertLines: { color: '#f0f0f0' },
            horzLines: { color: '#f0f0f0' },
        },
        timeScale: {
            borderColor: '#cccccc',
            visible: false,
        },
        rightPriceScale: {
            scaleMargins: {
                top: 0.1,
                bottom: 0.1,
            },
        }
    });

    // MACD ライン
    macdLineSeries = macdChart.addLineSeries({
        color: '#2962FF',
        lineWidth: 2,
        title: 'MACD'
    });

    // Signal ライン
    macdSignalSeries = macdChart.addLineSeries({
        color: '#FF6D00',
        lineWidth: 2,
        title: 'Signal'
    });

    // Histogram
    macdHistogramSeries = macdChart.addHistogramSeries({
        color: '#26a69a',
        priceFormat: {
            type: 'volume',
        },
        priceScaleId: '',
    });

    // クロスヘア同期
    chart.subscribeCrosshairMove((param) => {
        if (param.time) {
            macdChart.timeScale().scrollToPosition(
                chart.timeScale().scrollPosition(),
                false
            );
            
            // RSI表示
            const candleData = param.seriesData.get(candlestickSeries);
            if (candleData && candleData.customValues?.rsi) {
                const rsiElement = document.getElementById('gold10RSI');
                const rsi = candleData.customValues.rsi;
                rsiElement.textContent = rsi.toFixed(1);
                
                if (rsi >= 70) {
                    rsiElement.style.color = '#ef5350';
                } else if (rsi <= 30) {
                    rsiElement.style.color = '#26a69a';
                } else {
                    rsiElement.style.color = '#2962FF';
                }
            }
        }
    });

    // タイムスケール同期
    chart.timeScale().subscribeVisibleTimeRangeChange(() => {
        const timeRange = chart.timeScale().getVisibleRange();
        if (timeRange) {
            macdChart.timeScale().setVisibleRange(timeRange);
        }
    });

    // ウィンドウリサイズ対応
    window.addEventListener('resize', () => {
        chart.applyOptions({ 
            width: chartContainer.clientWidth,
            height: 400
        });
        macdChart.applyOptions({ 
            width: macdContainer.clientWidth,
            height: 150
        });
    });
}
```

---

## 管理者側チャート初期化

### 管理者チャート初期化
```javascript
async function initAdminChart() {
    try {
        const chartContainer = document.getElementById('adminChartContainer');
        const macdContainer = document.getElementById('adminMacdContainer');

        // メインチャート作成
        adminChart = LightweightCharts.createChart(chartContainer, {
            width: chartContainer.clientWidth,
            height: 500,
            layout: {
                background: { color: '#ffffff' },
                textColor: '#333',
            },
            grid: {
                vertLines: { color: '#f0f0f0' },
                horzLines: { color: '#f0f0f0' },
            },
            crosshair: {
                mode: LightweightCharts.CrosshairMode.Normal,
            },
            rightPriceScale: {
                borderColor: '#cccccc',
            },
            timeScale: {
                borderColor: '#cccccc',
                timeVisible: true,
                secondsVisible: false,
            },
        });

        // ローソク足シリーズ
        adminCandlestickSeries = adminChart.addCandlestickSeries({
            upColor: '#26a69a',
            downColor: '#ef5350',
            borderUpColor: '#26a69a',
            borderDownColor: '#ef5350',
            wickUpColor: '#26a69a',
            wickDownColor: '#ef5350',
        });

        // MACDチャート
        adminMacdChart = LightweightCharts.createChart(macdContainer, {
            width: macdContainer.clientWidth,
            height: 150,
            layout: {
                background: { color: '#ffffff' },
                textColor: '#333',
            },
            grid: {
                vertLines: { color: '#f0f0f0' },
                horzLines: { color: '#f0f0f0' },
            },
            timeScale: {
                borderColor: '#cccccc',
                visible: false,
            },
        });

        adminMacdLineSeries = adminMacdChart.addLineSeries({
            color: '#2962FF',
            lineWidth: 2,
        });

        adminMacdSignalSeries = adminMacdChart.addLineSeries({
            color: '#FF6D00',
            lineWidth: 2,
        });

        adminMacdHistogramSeries = adminMacdChart.addHistogramSeries({
            color: '#26a69a',
            priceFormat: { type: 'volume' },
        });

        // 最新100本のローソク足を取得
        const response = await axios.get('/api/gold10/candles/latest?limit=100');
        const candles = response.data.candles;

        if (candles && candles.length > 0) {
            // ローソク足データをセット
            const candleData = candles.map(c => ({
                time: c.timestamp,
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close
            }));
            adminCandlestickSeries.setData(candleData);

            // 最新価格・RSI表示
            const latest = candles[candles.length - 1];
            document.getElementById('adminGold10Price').textContent = '$' + latest.close.toFixed(2);
            document.getElementById('adminGold10RSI').textContent = latest.rsi ? latest.rsi.toFixed(1) : '--';

            // ローソク足総数表示
            document.getElementById('totalCandles').textContent = candles.length.toLocaleString();

            // サインマーカーをロード
            await loadAdminSignals();

            // MACD計算・表示
            const macdData = calculateMACD(candles);
            adminMacdLineSeries.setData(macdData.map(d => ({ time: d.time, value: d.macd })));
            adminMacdSignalSeries.setData(macdData.map(d => ({ time: d.time, value: d.signal })).filter(d => d.value !== null));
            adminMacdHistogramSeries.setData(macdData.map(d => ({
                time: d.time,
                value: d.histogram,
                color: d.histogram >= 0 ? '#26a69a' : '#ef5350'
            })));

            // チャートを最新に移動
            adminChart.timeScale().scrollToRealTime();
        }

        // 5秒ごとに更新
        setInterval(updateAdminChart, 5000);
        
        // カウントダウン開始
        startAdminCountdown();

        console.log('[Admin] チャート初期化完了');
    } catch (error) {
        console.error('[Admin] チャート初期化エラー:', error);
    }
}
```

---

## チャートデータ取得

### ユーザー側：初期データ読み込み
```javascript
async function loadGold10Chart() {
    try {
        // 過去12時間のローソク足データを取得
        const response = await axios.get('/api/gold10/candles?hours=12');
        const candles = response.data;

        // データを保存（RSI含む）
        candlesDataWithRSI = candles;

        // ローソク足データを Lightweight Charts 形式に変換
        const candleData = candles.map(c => ({
            time: c.timestamp,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            customValues: { rsi: c.rsi }
        }));

        // チャート初期化（初回のみ）
        if (!isChartInitialized) {
            initializeCharts();
            candlestickSeries.setData(candleData);
            isChartInitialized = true;
        }

        // MACD計算
        const macdData = calculateMACD(candles);
        macdLineSeries.setData(macdData.map(d => ({ time: d.time, value: d.macd })));
        macdSignalSeries.setData(macdData.map(d => ({ time: d.time, value: d.signal })).filter(d => d.value !== null));
        macdHistogramSeries.setData(macdData.map(d => ({
            time: d.time,
            value: d.histogram,
            color: d.histogram >= 0 ? '#26a69a' : '#ef5350'
        })));

        // 最新100本だけ表示
        const visibleCandles = candles.slice(-100);
        if (visibleCandles.length > 0) {
            const from = visibleCandles[0].timestamp;
            const to = visibleCandles[visibleCandles.length - 1].timestamp;
            chart.timeScale().setVisibleRange({ from, to });
            macdChart.timeScale().setVisibleRange({ from, to });
        }

        // 価格軸を自動調整
        chart.timeScale().fitContent();
        macdChart.timeScale().fitContent();

        // 最新価格・RSI表示
        const latestCandle = candles[candles.length - 1];
        if (latestCandle) {
            document.getElementById('gold10Price').textContent = '$' + latestCandle.close.toFixed(2);
            const rsiElement = document.getElementById('gold10RSI');
            rsiElement.textContent = latestCandle.rsi ? latestCandle.rsi.toFixed(1) : '--';
            
            if (latestCandle.rsi >= 70) {
                rsiElement.style.color = '#ef5350';
            } else if (latestCandle.rsi <= 30) {
                rsiElement.style.color = '#26a69a';
            } else {
                rsiElement.style.color = '#2962FF';
            }
        }

        // サインマーカーを読み込み
        await loadUserSignals();

    } catch (error) {
        console.error('チャートデータ取得エラー:', error);
    }
}
```

### 管理者側：チャート更新
```javascript
async function updateAdminChart() {
    try {
        // 最新100本を取得
        const response = await axios.get('/api/gold10/candles/latest?limit=100');
        const data = response.data;

        if (data.candles && data.candles.length > 0) {
            const candles = data.candles;
            const latestCandle = candles[candles.length - 1];

            // 価格・RSI更新
            document.getElementById('adminGold10Price').textContent = '$' + latestCandle.close.toFixed(2);
            document.getElementById('adminGold10RSI').textContent = latestCandle.rsi ? latestCandle.rsi.toFixed(1) : '--';
            document.getElementById('totalCandles').textContent = candles.length.toLocaleString();

            // 新しいローソク足があれば更新
            if (latestCandle.timestamp > window.__lastAdminCandleTime) {
                adminCandlestickSeries.update({
                    time: latestCandle.timestamp,
                    open: latestCandle.open,
                    high: latestCandle.high,
                    low: latestCandle.low,
                    close: latestCandle.close
                });
                window.__lastAdminCandleTime = latestCandle.timestamp;

                // サインマーカーを再読み込み
                await loadAdminSignals();
            }
        }
    } catch (error) {
        console.error('[Admin] チャート更新エラー:', error);
    }
}
```

---

## サインマーカー表示

### ユーザー側：サインマーカー読み込み
```javascript
async function loadUserSignals() {
    try {
        console.log('[User] === loadUserSignals 開始 ===');
        
        if (!candlesDataWithRSI || candlesDataWithRSI.length === 0) {
            console.warn('[User] candlesDataWithRSI が空です');
            return;
        }

        console.log('[User] candlesDataWithRSI length:', candlesDataWithRSI.length);
        console.log('[User] candlestickSeries:', candlestickSeries ? 'initialized' : 'NOT initialized');

        // サインデータを取得（過去24時間）
        const signalsResponse = await axios.get('/api/gold10/signals?hours=24');
        const signals = signalsResponse.data || [];
        
        console.log('[User] サイン取得:', signals.length, '件');
        console.log('[User] 最新5件のサイン:', signals.slice(0, 5));

        // ローソク足のタイムスタンプセットを作成
        const candleTimestamps = new Set(candlesDataWithRSI.map(c => c.timestamp));
        console.log('[User] ローソク足データ数:', candlesDataWithRSI.length);
        console.log('[User] ローソク足範囲:', 
            Math.min(...candleTimestamps), 'to', Math.max(...candleTimestamps));

        // サインをフィルタリング（対応するローソク足が存在するもののみ）
        const markers = [];
        for (const signal of signals) {
            if (candleTimestamps.has(signal.timestamp)) {
                console.log('[User] サイン一致:', signal.type, 'at', signal.timestamp);
                markers.push({
                    time: signal.timestamp,
                    position: signal.type === 'BUY' ? 'belowBar' : 'aboveBar',
                    color: signal.type === 'BUY' ? '#26a69a' : '#ef5350',
                    shape: signal.type === 'BUY' ? 'arrowUp' : 'arrowDown',
                    text: signal.type === 'BUY' ? '買' : '売'
                });
            } else {
                console.log('[User] サイン除外（ローソク足なし）:', signal.type, 'at', signal.timestamp);
            }
        }

        console.log('[User] マーカー表示:', markers.length, '件');
        console.log('[User] マーカー詳細:', markers);

        // マーカーを設定
        if (candlestickSeries) {
            candlestickSeries.setMarkers(markers);
            console.log('[User] マーカー設定完了');
        } else {
            console.error('[User] candlestickSeries が未初期化');
        }
        
        console.log('[User] === loadUserSignals 完了 ===');
    } catch (error) {
        console.error('[User] サインマーカー読み込みエラー:', error);
    }
}
```

### 管理者側：サインマーカー読み込み
```javascript
async function loadAdminSignals() {
    try {
        console.log('[Admin] === loadAdminSignals 開始 ===');

        // 過去24時間のサインを取得
        const response = await axios.get('/api/gold10/signals?hours=24');
        const signals = response.data || [];

        console.log('[Admin] サイン取得:', signals.length, '件');

        // 現在チャートに表示されているローソク足データを取得
        const candlesResponse = await axios.get('/api/gold10/candles/latest?limit=100');
        const candles = candlesResponse.data.candles || [];
        const candleTimestamps = new Set(candles.map(c => c.timestamp));

        console.log('[Admin] ローソク足データ数:', candles.length);

        // マーカーを作成（対応するローソク足が存在するもののみ）
        const markers = [];
        for (const signal of signals) {
            if (candleTimestamps.has(signal.timestamp)) {
                markers.push({
                    time: signal.timestamp,
                    position: signal.type === 'BUY' ? 'belowBar' : 'aboveBar',
                    color: signal.type === 'BUY' ? '#26a69a' : '#ef5350',
                    shape: signal.type === 'BUY' ? 'arrowUp' : 'arrowDown',
                    text: signal.type === 'BUY' ? '買' : '売'
                });
            }
        }

        console.log('[Admin] マーカー表示:', markers.length, '件');

        // マーカーを設定
        if (adminCandlestickSeries) {
            adminCandlestickSeries.setMarkers(markers);
            console.log('[Admin] マーカー設定完了');
        }

        console.log('[Admin] === loadAdminSignals 完了 ===');
    } catch (error) {
        console.error('[Admin] サインマーカー読み込みエラー:', error);
    }
}
```

---

## リアルタイム更新（ポーリング）

### ユーザー側：5秒ポーリング
```javascript
// Genspark サーバー同期モード（5秒ごとにポーリング）
if (showChart && !pollingStarted) {
    console.log('[Genspark] ✅ サーバー同期モード開始');
    pollingStarted = true;

    setInterval(async () => {
        try {
            const response = await axios.get('/api/gold10/candles/latest?limit=100');
            const data = response.data;

            // カウントダウン更新
            const countdownElement = document.getElementById('countdown');
            if (countdownElement && data.secondsUntilNext !== undefined) {
                countdownElement.textContent = data.secondsUntilNext + '秒';
                
                if (data.secondsUntilNext <= 10) {
                    countdownElement.style.color = '#ef5350';
                    countdownElement.classList.add('animate-pulse');
                } else {
                    countdownElement.style.color = '#2962FF';
                    countdownElement.classList.remove('animate-pulse');
                }
            }

            // 新しいローソク足チェック
            if (data.candles && data.candles.length > 0) {
                const latestCandle = data.candles[data.candles.length - 1];
                
                // 新しいローソク足が検出された場合
                if (latestCandle.timestamp > window.__lastCandleTime) {
                    console.log('[Genspark] 🆕 新しいローソク足検出:', {
                        time: new Date(latestCandle.timestamp * 1000).toISOString(),
                        close: latestCandle.close.toFixed(2),
                        rsi: latestCandle.rsi ? latestCandle.rsi.toFixed(1) : 'N/A'
                    });
                    
                    // 新しいローソク足のみチャートに追加（既存は更新しない）
                    if (candlestickSeries) {
                        const alreadyExists = candlesDataWithRSI.some(c => c.timestamp === latestCandle.timestamp);
                        if (!alreadyExists) {
                            candlestickSeries.update({
                                time: latestCandle.timestamp,
                                open: latestCandle.open,
                                high: latestCandle.high,
                                low: latestCandle.low,
                                close: latestCandle.close
                            });
                            console.log('[Genspark] ✅ 新しいローソク足をチャートに追加:', latestCandle.timestamp);
                        } else {
                            console.log('[Genspark] ⏭️ ローソク足は既に存在（スキップ）:', latestCandle.timestamp);
                        }
                    }
                    
                    // RSI表示更新
                    if (latestCandle.rsi) {
                        const rsiElement = document.getElementById('gold10RSI');
                        if (rsiElement) {
                            rsiElement.textContent = latestCandle.rsi.toFixed(1);
                            if (latestCandle.rsi >= 70) {
                                rsiElement.style.color = '#ef5350';
                            } else if (latestCandle.rsi <= 30) {
                                rsiElement.style.color = '#26a69a';
                            } else {
                                rsiElement.style.color = '#2962FF';
                            }
                        }
                    }
                    
                    // 価格表示更新
                    const priceElement = document.getElementById('gold10Price');
                    if (priceElement) {
                        priceElement.textContent = '$' + latestCandle.close.toFixed(2);
                    }
                    
                    // currentPrice更新
                    currentPrice = latestCandle.close;
                    
                    // タイムスタンプ更新
                    window.__lastCandleTime = latestCandle.timestamp;
                    
                    // candlesDataWithRSI に追加
                    if (!candlesDataWithRSI.some(c => c.timestamp === latestCandle.timestamp)) {
                        candlesDataWithRSI.push(latestCandle);
                    }
                    
                    // サインマーカーを更新
                    await loadUserSignals();
                }
            }
        } catch (error) {
            console.error('[Genspark] ❌ ポーリングエラー:', error);
        }
    }, 5000); // 5秒ごと

    console.log('[Genspark] 📡 サーバー同期完了');
}
```

### 管理者側：5秒ポーリング
```javascript
// 5秒ごとに更新
setInterval(updateAdminChart, 5000);
```

---

## MACD計算

### MACD計算関数
```javascript
function calculateMACD(candles, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    if (!candles || candles.length < slowPeriod) return [];

    const closes = candles.map(c => c.close);
    
    // EMA計算関数
    function calculateEMA(data, period) {
        const k = 2 / (period + 1);
        const ema = [data[0]];
        
        for (let i = 1; i < data.length; i++) {
            ema.push(data[i] * k + ema[i - 1] * (1 - k));
        }
        
        return ema;
    }
    
    // Fast EMA (12)
    const fastEMA = calculateEMA(closes, fastPeriod);
    
    // Slow EMA (26)
    const slowEMA = calculateEMA(closes, slowPeriod);
    
    // MACD Line
    const macdLine = fastEMA.map((fast, i) => fast - slowEMA[i]);
    
    // Signal Line (9-period EMA of MACD)
    const signalLine = calculateEMA(macdLine, signalPeriod);
    
    // Histogram
    const histogram = macdLine.map((macd, i) => macd - signalLine[i]);
    
    // 結果を返す
    return candles.map((candle, i) => ({
        time: candle.timestamp,
        macd: macdLine[i],
        signal: i >= signalPeriod - 1 ? signalLine[i] : null,
        histogram: i >= signalPeriod - 1 ? histogram[i] : 0
    }));
}
```

---

## RSI表示

### RSI色分けロジック
```javascript
// RSI色分け
if (latestCandle.rsi) {
    const rsiElement = document.getElementById('gold10RSI');
    rsiElement.textContent = latestCandle.rsi.toFixed(1);
    
    if (latestCandle.rsi >= 70) {
        rsiElement.style.color = '#ef5350';  // 赤（買われすぎ）
    } else if (latestCandle.rsi <= 30) {
        rsiElement.style.color = '#26a69a';  // 緑（売られすぎ）
    } else {
        rsiElement.style.color = '#2962FF';  // 青（中立）
    }
}
```

### クロスヘアでRSI表示
```javascript
chart.subscribeCrosshairMove((param) => {
    if (param.time) {
        const candleData = param.seriesData.get(candlestickSeries);
        if (candleData && candleData.customValues?.rsi) {
            const rsiElement = document.getElementById('gold10RSI');
            const rsi = candleData.customValues.rsi;
            rsiElement.textContent = rsi.toFixed(1);
            
            if (rsi >= 70) {
                rsiElement.style.color = '#ef5350';
            } else if (rsi <= 30) {
                rsiElement.style.color = '#26a69a';
            } else {
                rsiElement.style.color = '#2962FF';
            }
        }
    }
});
```

---

## チャート設定まとめ

### ローソク足の色
```javascript
upColor: '#26a69a',      // 陽線（緑）
downColor: '#ef5350',    // 陰線（赤）
```

### サインマーカーの色
```javascript
BUY:  '#26a69a' (緑) + arrowUp (上矢印)
SELL: '#ef5350' (赤) + arrowDown (下矢印)
```

### RSIの色
```javascript
RSI >= 70: '#ef5350' (赤) - 買われすぎ
RSI <= 30: '#26a69a' (緑) - 売られすぎ
その他:    '#2962FF' (青) - 中立
```

### MACDの色
```javascript
MACD Line:     '#2962FF' (青)
Signal Line:   '#FF6D00' (オレンジ)
Histogram正:   '#26a69a' (緑)
Histogram負:   '#ef5350' (赤)
```

---

## 重要な変数

### グローバル変数
```javascript
// ユーザー側
let chart = null;
let candlestickSeries = null;
let macdChart = null;
let macdLineSeries = null;
let macdSignalSeries = null;
let macdHistogramSeries = null;
let candlesDataWithRSI = [];
let isChartInitialized = false;
window.__lastCandleTime = 0;

// 管理者側
let adminChart = null;
let adminCandlestickSeries = null;
let adminMacdChart = null;
let adminMacdLineSeries = null;
let adminMacdSignalSeries = null;
let adminMacdHistogramSeries = null;
window.__lastAdminCandleTime = 0;
```

---

**作成日**: 2026-02-16  
**最終更新**: 2026-02-16
