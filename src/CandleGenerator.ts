// Durable Object for generating candles every 30 seconds
export class CandleGenerator {
  private state: DurableObjectState
  private env: any
  private interval: number | null = null
  private lastClose: number = 4925.0
  private prevDirection: number = 0
  private avgVolatility: number = 0.05
  private recentPrices: number[] = []
  private nextCandleTime: number = 0
  private isInitialized: boolean = false

  constructor(state: DurableObjectState, env: any) {
    this.state = state
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Initialize on first request
    if (!this.isInitialized) {
      await this.initialize()
    }

    if (url.pathname === '/start') {
      this.startGenerator()
      return new Response(JSON.stringify({ status: 'started', nextCandleTime: this.nextCandleTime }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    if (url.pathname === '/stop') {
      this.stopGenerator()
      return new Response(JSON.stringify({ status: 'stopped' }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    if (url.pathname === '/status') {
      const now = Math.floor(Date.now() / 1000)
      const secondsUntilNext = this.nextCandleTime > now ? this.nextCandleTime - now : 0
      
      return new Response(JSON.stringify({ 
        status: 'running',
        nextCandleTime: this.nextCandleTime,
        secondsUntilNext: secondsUntilNext,
        lastClose: this.lastClose,
        isRunning: this.interval !== null
      }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    return new Response('Not found', { status: 404 })
  }

  async initialize() {
    console.log('[CandleGenerator] Initializing...')
    
    // Get the latest candle from DB
    try {
      const result = await this.env.DB.prepare(`
        SELECT time, close FROM gold10_candles 
        ORDER BY time DESC 
        LIMIT 1
      `).first()

      if (result) {
        this.lastClose = result.close
        this.nextCandleTime = result.time + 30
        console.log('[CandleGenerator] Loaded from DB:', { lastClose: this.lastClose, nextCandleTime: this.nextCandleTime })
      } else {
        // No data in DB, start fresh
        this.nextCandleTime = Math.floor(Date.now() / 1000 / 30) * 30 + 30
        console.log('[CandleGenerator] Starting fresh:', { nextCandleTime: this.nextCandleTime })
      }
    } catch (error) {
      console.error('[CandleGenerator] DB error:', error)
      this.nextCandleTime = Math.floor(Date.now() / 1000 / 30) * 30 + 30
    }

    this.isInitialized = true
  }

  startGenerator() {
    if (this.interval !== null) {
      console.log('[CandleGenerator] Already running')
      return
    }

    console.log('[CandleGenerator] Starting 30-second generator...')
    
    // Start interval
    this.interval = setInterval(() => {
      this.generateCandle()
    }, 30000) as any

    // Generate first candle immediately if needed
    const now = Math.floor(Date.now() / 1000)
    if (this.nextCandleTime <= now) {
      this.generateCandle()
    }
  }

  stopGenerator() {
    if (this.interval !== null) {
      clearInterval(this.interval)
      this.interval = null
      console.log('[CandleGenerator] Stopped')
    }
  }

  async generateCandle() {
    try {
      console.log('[CandleGenerator] ⏰ Generating new candle...')
      
      const open = this.lastClose

      // Inertia logic - 65% chance to keep direction
      let trendDirection = 0
      if (this.prevDirection !== 0) {
        const momentum = Math.random()
        if (momentum < 0.65) {
          trendDirection = this.prevDirection
        } else {
          trendDirection = -this.prevDirection
        }
      } else {
        trendDirection = Math.random() > 0.5 ? 1 : -1
      }

      // Trend strength
      let trendStrength = 0.05 + Math.random() * 0.15
      if (this.prevDirection !== 0 && trendDirection !== this.prevDirection) {
        trendStrength = trendStrength * (0.3 + Math.random() * 0.2)
      } else if (this.prevDirection !== 0 && trendDirection === this.prevDirection) {
        const prevBodySize = this.recentPrices.length >= 2 
          ? Math.abs(this.recentPrices[this.recentPrices.length - 1] - this.recentPrices[this.recentPrices.length - 2])
          : 0
        if (prevBodySize > 10) {
          trendStrength = trendStrength * 0.7
        }
      }

      // Volatility
      const targetVolatility = this.avgVolatility * (0.8 + Math.random() * 0.4)
      const volatility = Math.max(0.02, Math.min(0.15, targetVolatility))

      // Generate price points
      const prices = []
      let currentPrice = open

      const meanReversionTarget = this.recentPrices.length >= 3
        ? this.recentPrices.reduce((a, b) => a + b, 0) / this.recentPrices.length
        : open

      for (let i = 0; i < 10; i++) {
        const meanReversion = (meanReversionTarget - currentPrice) * 0.0005
        const progress = i / 10

        let accelerationFactor = 1.0
        if (progress < 0.3) {
          accelerationFactor = 0.7 + progress
        } else if (progress > 0.7) {
          accelerationFactor = 1.0 - (progress - 0.7) * 1.0
        } else {
          accelerationFactor = 1.0 + (progress - 0.3) * 0.5
        }

        const trendComponent = trendDirection * trendStrength * accelerationFactor
        const randomWalk = (Math.random() - 0.5) * volatility

        currentPrice = currentPrice + meanReversion + trendComponent + randomWalk
        prices.push(currentPrice)
      }

      const close = prices[prices.length - 1]
      const high = Math.max(open, close, ...prices)
      const low = Math.min(open, close, ...prices)

      // Calculate RSI (simplified)
      let rsi = 50
      if (this.recentPrices.length >= 14) {
        const recent = [...this.recentPrices.slice(-14), close]
        let gains = 0
        let losses = 0
        
        for (let i = 1; i < recent.length; i++) {
          const change = recent[i] - recent[i - 1]
          if (change > 0) {
            gains += change
          } else {
            losses += Math.abs(change)
          }
        }
        
        const avgGain = gains / 14
        const avgLoss = losses / 14
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
        rsi = 100 - (100 / (1 + rs))
      }

      // Save to DB
      const candleTime = this.nextCandleTime
      await this.env.DB.prepare(`
        INSERT INTO gold10_candles (time, open, high, low, close, rsi)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(candleTime, open, high, low, close, rsi).run()

      console.log('[CandleGenerator] ✅ Saved candle:', { 
        time: new Date(candleTime * 1000).toISOString(),
        open: open.toFixed(2), 
        high: high.toFixed(2), 
        low: low.toFixed(2), 
        close: close.toFixed(2),
        rsi: rsi.toFixed(1)
      })

      // Update state
      this.lastClose = close
      this.prevDirection = close > open ? 1 : (close < open ? -1 : 0)
      this.recentPrices.push(close)
      if (this.recentPrices.length > 5) {
        this.recentPrices.shift()
      }

      // Update volatility
      if (this.recentPrices.length >= 2) {
        let totalVol = 0
        const count = Math.min(3, this.recentPrices.length - 1)
        for (let i = 0; i < count; i++) {
          const idx = this.recentPrices.length - 1 - i
          totalVol += Math.abs(this.recentPrices[idx] - this.recentPrices[idx - 1])
        }
        this.avgVolatility = totalVol / count
      }

      // Next candle time
      this.nextCandleTime += 30

    } catch (error) {
      console.error('[CandleGenerator] Error generating candle:', error)
    }
  }
}
