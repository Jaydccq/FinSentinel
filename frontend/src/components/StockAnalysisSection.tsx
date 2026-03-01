import { useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sparkles, TrendingUp, TrendingDown, Target, ShieldAlert,
  ChevronDown, ChevronUp, Loader2, ArrowRightCircle
} from 'lucide-react'
import { analysisApi, parseAnalysisResult, type StockAnalysisResult } from '../api/analysis'
import { tradingApi } from '../api/trading'

interface Props {
  ticker: string
  currentPrice?: number | null
}

const REC_COLORS: Record<string, string> = {
  STRONG_BUY: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30',
  BUY: 'bg-green-500/20 text-green-300 border-green-400/30',
  HOLD: 'bg-amber-500/20 text-amber-300 border-amber-400/30',
  SELL: 'bg-orange-500/20 text-orange-300 border-orange-400/30',
  STRONG_SELL: 'bg-red-500/20 text-red-300 border-red-400/30',
}

const REC_LABELS: Record<string, string> = {
  STRONG_BUY: 'Strong Buy',
  BUY: 'Buy',
  HOLD: 'Hold',
  SELL: 'Sell',
  STRONG_SELL: 'Strong Sell',
}

const RISK_COLORS: Record<string, string> = {
  LOW: 'text-emerald-400',
  MEDIUM: 'text-amber-400',
  HIGH: 'text-orange-400',
  CRITICAL: 'text-red-400',
}

export default function StockAnalysisSection({ ticker }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [narrative, setNarrative] = useState('')
  const [result, setResult] = useState<StockAnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [staged, setStaged] = useState(false)
  const [stagingError, setStagingError] = useState<string | null>(null)
  const narrativeRef = useRef<HTMLDivElement>(null)

  const runAnalysis = useCallback(() => {
    setIsRunning(true)
    setNarrative('')
    setResult(null)
    setError(null)
    setStaged(false)
    setStagingError(null)
    setIsOpen(true)

    analysisApi.stream(
      ticker,
      (chunk) => {
        setNarrative(prev => prev + chunk)
        if (narrativeRef.current) {
          narrativeRef.current.scrollTop = narrativeRef.current.scrollHeight
        }
      },
      (fullText) => {
        setIsRunning(false)
        const parsed = parseAnalysisResult(fullText)
        if (parsed) setResult(parsed)
      },
      (err) => {
        setIsRunning(false)
        setError(err)
      }
    )
  }, [ticker])

  const handleStage = async () => {
    if (!result?.suggestedAction || result.suggestedAction.action === 'HOLD') return
    try {
      await tradingApi.stage({
        action: result.suggestedAction.action,
        ticker,
        shares: result.suggestedAction.shares ?? undefined,
        amount: result.suggestedAction.amount ?? undefined,
      })
      setStaged(true)
    } catch (e) {
      setStagingError(e instanceof Error ? e.message : 'Failed to stage trade')
    }
  }

  // Strip the JSON block from display text
  const displayNarrative = narrative.replace(/```json[\s\S]*?```/g, '').trim()

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.12 }}
      className="bg-zinc-900 rounded-xl border border-zinc-800/50 overflow-hidden"
    >
      {/* Header with trigger button */}
      <div className="flex items-center justify-between p-6">
        <div className="flex items-center gap-3">
          <span className="w-[2px] h-5 bg-emerald-500 rounded-full inline-block" />
          <Sparkles size={16} className="text-emerald-400" />
          <h2 className="text-lg font-display text-zinc-200">AI Stock Analysis</h2>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={runAnalysis}
            disabled={isRunning}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/15 text-emerald-300 font-medium text-sm border border-emerald-400/20 hover:bg-emerald-500/25 hover:border-emerald-400/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
          >
            {isRunning ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Sparkles size={14} />
                {narrative ? 'Re-analyze' : 'Run AI Analysis'}
              </>
            )}
          </button>

          {(narrative || error) && (
            <button onClick={() => setIsOpen(!isOpen)} className="text-zinc-500 hover:text-zinc-300">
              {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
          )}
        </div>
      </div>

      {/* Expandable content */}
      <AnimatePresence>
        {isOpen && (narrative || error) && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="px-6 pb-6 space-y-6">
              {/* Error state */}
              {error && (
                <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
                  Analysis failed: {error}
                </div>
              )}

              {/* Streaming narrative */}
              {displayNarrative && (
                <div
                  ref={narrativeRef}
                  className="max-h-[500px] overflow-y-auto pr-2 text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap font-mono"
                  style={{ scrollbarWidth: 'thin', scrollbarColor: '#3f3f46 transparent' }}
                >
                  {displayNarrative}
                  {isRunning && <span className="inline-block w-2 h-4 bg-emerald-400/60 animate-pulse ml-0.5" />}
                </div>
              )}

              {/* Structured result card */}
              {result && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  {/* Recommendation header */}
                  <div className="flex items-center gap-4 flex-wrap">
                    <span className={`px-3 py-1.5 rounded-lg text-sm font-bold border ${REC_COLORS[result.recommendation] ?? ''}`}>
                      {REC_LABELS[result.recommendation] ?? result.recommendation}
                    </span>
                    <span className="text-zinc-400 text-sm">
                      Confidence: <span className="text-zinc-200 font-semibold">{result.confidencePercent}%</span>
                    </span>
                    <span className="text-zinc-400 text-sm">
                      Value: <span className="text-zinc-200 font-semibold">{result.valueRating} ({result.valueScore}/12)</span>
                    </span>
                    <span className={`text-sm ${RISK_COLORS[result.riskLevel] ?? 'text-zinc-400'}`}>
                      <ShieldAlert size={13} className="inline mr-1" />
                      {result.riskLevel} Risk
                    </span>
                  </div>

                  {/* Price zones grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-lg p-3">
                      <p className="text-emerald-400/70 text-xs flex items-center gap-1"><TrendingUp size={11} />Buy Zone</p>
                      <p className="text-emerald-300 font-semibold font-data tabular-nums mt-1">
                        ${result.buyZone.low.toFixed(2)} – ${result.buyZone.high.toFixed(2)}
                      </p>
                    </div>
                    <div className="bg-amber-500/5 border border-amber-500/15 rounded-lg p-3">
                      <p className="text-amber-400/70 text-xs flex items-center gap-1"><Target size={11} />Target Price</p>
                      <p className="text-amber-300 font-semibold font-data tabular-nums mt-1">
                        ${result.targetPrice.toFixed(2)}
                        <span className="text-xs ml-1 text-amber-400/60">(+{result.impliedUpside.toFixed(1)}%)</span>
                      </p>
                    </div>
                    <div className="bg-orange-500/5 border border-orange-500/15 rounded-lg p-3">
                      <p className="text-orange-400/70 text-xs flex items-center gap-1"><TrendingDown size={11} />Sell Zone</p>
                      <p className="text-orange-300 font-semibold font-data tabular-nums mt-1">
                        ${result.sellZone.low.toFixed(2)} – ${result.sellZone.high.toFixed(2)}
                      </p>
                    </div>
                    <div className="bg-red-500/5 border border-red-500/15 rounded-lg p-3">
                      <p className="text-red-400/70 text-xs flex items-center gap-1"><ShieldAlert size={11} />Stop Loss</p>
                      <p className="text-red-300 font-semibold font-data tabular-nums mt-1">
                        ${result.stopLoss.toFixed(2)}
                      </p>
                    </div>
                  </div>

                  {/* Key Forces */}
                  {result.keyForces.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-zinc-500 text-xs">Key Forces:</span>
                      {result.keyForces.map((force, i) => (
                        <span key={i} className="px-2 py-0.5 rounded text-xs bg-zinc-800 text-zinc-300 border border-zinc-700/50">
                          {force}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Stage trade action */}
                  {result.suggestedAction && result.suggestedAction.action !== 'HOLD' && (
                    <div className="flex items-center gap-4 p-4 rounded-lg bg-zinc-800/50 border border-zinc-700/30">
                      <div className="flex-1">
                        <p className="text-zinc-300 text-sm font-medium">
                          Suggested: <span className={result.suggestedAction.action === 'BUY' ? 'text-emerald-400' : 'text-red-400'}>
                            {result.suggestedAction.action}
                          </span>
                          {' '}{ticker}
                          {result.suggestedAction.shares && ` × ${result.suggestedAction.shares} shares`}
                          {result.suggestedAction.amount && ` $${result.suggestedAction.amount}`}
                        </p>
                        <p className="text-zinc-500 text-xs mt-0.5">{result.suggestedAction.rationale}</p>
                      </div>
                      {staged ? (
                        <span className="px-3 py-1.5 rounded-lg text-xs bg-emerald-500/15 text-emerald-300 border border-emerald-400/20">
                          Staged
                        </span>
                      ) : (
                        <button
                          onClick={handleStage}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-amber-500/15 text-amber-300 border border-amber-400/20 hover:bg-amber-500/25 hover:border-amber-400/40 transition-all"
                        >
                          <ArrowRightCircle size={14} />
                          Stage Trade
                        </button>
                      )}
                      {stagingError && <span className="text-red-400 text-xs">{stagingError}</span>}
                    </div>
                  )}

                  {/* Disclaimer */}
                  <p className="text-zinc-600 text-[10px] leading-tight">
                    {result.disclaimer}
                  </p>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
