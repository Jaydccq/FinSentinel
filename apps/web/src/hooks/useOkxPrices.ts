import { useState, useEffect, useCallback, useRef } from 'react'
import { okxApi, type OkxTicker } from '../api/okx'

export interface PriceSnapshot {
  instId: string
  last: number
  bid: number
  ask: number
  vol24h: number
  change24h: number // percentage
  updatedAt: Date
}

const DEFAULT_PAIRS = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT']
const POLL_INTERVAL = 10_000 // 10 seconds

/**
 * Polls OKX ticker data for a list of instrument pairs and maintains a live
 * price map. When the backend SSE endpoint is ready this hook can be swapped
 * to an EventSource-based implementation with no API change.
 */
export function useOkxPrices(pairs: string[] = DEFAULT_PAIRS) {
  const [prices, setPrices] = useState<Map<string, PriceSnapshot>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Keep a stable ref to the latest pairs array so the interval callback
  // always uses the current value without needing to restart the timer.
  const pairsRef = useRef(pairs)
  pairsRef.current = pairs

  const fetchPrices = useCallback(async () => {
    const currentPairs = pairsRef.current
    if (currentPairs.length === 0) {
      setLoading(false)
      return
    }

    try {
      const results = await Promise.allSettled(
        currentPairs.map((pair) => okxApi.ticker(pair)),
      )

      setPrices((prev) => {
        const next = new Map(prev)
        results.forEach((result, index) => {
          if (result.status === 'fulfilled' && result.value) {
            const ticker: OkxTicker = result.value
            const last = parseFloat(ticker.last || '0')
            const open = parseFloat(ticker.open24h || '0')
            next.set(currentPairs[index], {
              instId: currentPairs[index],
              last,
              bid: parseFloat(ticker.bidPx || '0'),
              ask: parseFloat(ticker.askPx || '0'),
              vol24h: parseFloat(ticker.vol24h || '0'),
              change24h: open > 0 ? ((last - open) / open) * 100 : 0,
              updatedAt: new Date(),
            })
          }
        })
        return next
      })

      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch prices')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPrices()
    const interval = setInterval(fetchPrices, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchPrices])

  return { prices, loading, error, refresh: fetchPrices }
}
