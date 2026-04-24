import { resolveBase, authHeaders } from './client'

export interface PriceZone {
  low: number
  high: number
}

export interface SuggestedAction {
  action: 'BUY' | 'SELL' | 'HOLD'
  shares: number | null
  amount: number | null
  rationale: string
}

export interface StockAnalysisResult {
  ticker: string
  currentPrice: number
  recommendation: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL'
  confidencePercent: number
  valueScore: number
  valueRating: 'A' | 'B' | 'C' | 'D'
  buyZone: PriceZone
  sellZone: PriceZone
  stopLoss: number
  targetPrice: number
  impliedUpside: number
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  keyForces: string[]
  suggestedAction: SuggestedAction
  disclaimer: string
}

function isValidResult(v: unknown): v is StockAnalysisResult {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.ticker === 'string' &&
    typeof o.currentPrice === 'number' &&
    typeof o.recommendation === 'string' &&
    typeof o.confidencePercent === 'number' &&
    typeof o.valueScore === 'number' &&
    typeof o.targetPrice === 'number' &&
    typeof o.stopLoss === 'number' &&
    typeof o.impliedUpside === 'number' &&
    typeof o.riskLevel === 'string' &&
    o.buyZone != null && typeof (o.buyZone as PriceZone).low === 'number' &&
    o.sellZone != null && typeof (o.sellZone as PriceZone).low === 'number' &&
    Array.isArray(o.keyForces) &&
    o.suggestedAction != null && typeof (o.suggestedAction as SuggestedAction).action === 'string'
  )
}

export function parseAnalysisResult(fullText: string): StockAnalysisResult | null {
  const match = fullText.match(/```json\s*([\s\S]*?)\s*```/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[1])
    return isValidResult(parsed) ? parsed : null
  } catch {
    return null
  }
}

export const analysisApi = {
  stream: async (
    ticker: string,
    onChunk: (text: string) => void,
    onDone: (fullText: string) => void,
    onError: (err: string) => void
  ): Promise<void> => {
    try {
      const res = await fetch(`${resolveBase()}/analysis/stream/${encodeURIComponent(ticker)}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...authHeaders(),
        },
      })

      if (!res.ok) {
        onError(`HTTP ${res.status}`)
        return
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let fullText = ''
      let receivedDone = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        let eventName = ''
        for (const line of lines) {
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim()
          } else if (line.startsWith('data:')) {
            const data = line.slice(5).trim()
            if (eventName === 'done') {
              receivedDone = true
              onDone(fullText)
            } else if (eventName === 'error') {
              receivedDone = true
              try { onError(JSON.parse(data).message) } catch { onError(data) }
            } else if (eventName === 'message') {
              try {
                const parsed = JSON.parse(data)
                const content = parsed.content ?? ''
                fullText += content
                onChunk(content)
              } catch { /* ignore malformed */ }
            }
          } else if (line === '') {
            eventName = ''
          }
        }
      }

      // Fallback: if stream ended without a done/error event, still resolve
      if (!receivedDone) {
        if (fullText) {
          onDone(fullText)
        } else {
          onError('Stream ended unexpectedly')
        }
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Connection failed')
    }
  },
}
