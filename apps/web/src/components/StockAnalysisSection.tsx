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
  STRONG_BUY: 'bg-blue-500/15 text-blue-300 border-blue-400/30',
  BUY: 'bg-blue-500/10 text-blue-400 border-blue-400/20',
  HOLD: 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-strong)]',
  SELL: 'bg-red-500/10 text-red-400 border-red-500/20',
  STRONG_SELL: 'bg-red-500/15 text-red-300 border-red-400/30',
}

const REC_LABELS: Record<string, string> = {
  STRONG_BUY: 'Strong Buy',
  BUY: 'Buy',
  HOLD: 'Hold',
  SELL: 'Sell',
  STRONG_SELL: 'Strong Sell',
}

const RISK_COLORS: Record<string, string> = {
  LOW: 'text-[var(--up)]',
  MEDIUM: 'text-[var(--warn)]',
  HIGH: 'text-orange-400',
  CRITICAL: 'text-[var(--down)]',
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
      className="bg-[var(--bg-panel)] rounded border border-[var(--border-subtle)] overflow-hidden"
    >
      {/* Header with trigger button */}
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="w-[2px] h-4 bg-blue-500 inline-block" />
          <Sparkles size={14} className="text-blue-400" />
          <h2 className="text-sm font-semibold text-[var(--text-primary)] tracking-wide uppercase">AI Stock Analysis</h2>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={runAnalysis}
            disabled={isRunning}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded bg-blue-500/15 text-blue-300 font-medium text-xs border border-blue-400/20 hover:bg-blue-500/25 hover:border-blue-400/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
          >
            {isRunning ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Sparkles size={12} />
                {narrative ? 'Re-analyze' : 'Run AI Analysis'}
              </>
            )}
          </button>

          {(narrative || error) && (
            <button onClick={() => setIsOpen(!isOpen)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
              {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
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
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="border-t border-[var(--border-subtle)] px-5 py-4 space-y-4">
              {/* Error state */}
              {error && (
                <div className="p-3 rounded bg-red-500/10 border border-red-500/20 text-[var(--down)] text-xs">
                  Analysis failed: {error}
                </div>
              )}

              {/* Streaming narrative */}
              {displayNarrative && (
                <div
                  ref={narrativeRef}
                  className="max-h-[480px] overflow-y-auto pr-2 text-xs text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap font-mono"
                  style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--border-strong) transparent' }}
                >
                  {displayNarrative}
                  {isRunning && <span className="inline-block w-2 h-3.5 bg-blue-400/60 animate-pulse ml-0.5" />}
                </div>
              )}

              {/* Structured result card */}
              {result && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-3"
                >
                  {/* Recommendation header */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className={`px-2.5 py-1 rounded text-xs font-bold border status-chip ${REC_COLORS[result.recommendation] ?? ''}`}>
                      {REC_LABELS[result.recommendation] ?? result.recommendation}
                    </span>
                    <span className="text-[var(--text-muted)] text-xs">
                      Confidence: <span className="text-[var(--text-primary)] font-semibold">{result.confidencePercent}%</span>
                    </span>
                    <span className="text-[var(--text-muted)] text-xs">
                      Value: <span className="text-[var(--text-primary)] font-semibold">{result.valueRating} ({result.valueScore}/12)</span>
                    </span>
                    <span className={`text-xs ${RISK_COLORS[result.riskLevel] ?? 'text-[var(--text-muted)]'}`}>
                      <ShieldAlert size={11} className="inline mr-1" />
                      {result.riskLevel} Risk
                    </span>
                  </div>

                  {/* Price zones grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded p-2.5">
                      <p className="text-[var(--up)] text-[10px] flex items-center gap-1 opacity-70"><TrendingUp size={10} />Buy Zone</p>
                      <p className="text-green-400 font-semibold font-mono text-xs tabular-nums mt-1">
                        ${result.buyZone.low.toFixed(2)} – ${result.buyZone.high.toFixed(2)}
                      </p>
                    </div>
                    <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded p-2.5">
                      <p className="text-blue-400 text-[10px] flex items-center gap-1 opacity-70"><Target size={10} />Target Price</p>
                      <p className="text-blue-300 font-semibold font-mono text-xs tabular-nums mt-1">
                        ${result.targetPrice.toFixed(2)}
                        <span className="text-[10px] ml-1 text-blue-400/60">(+{result.impliedUpside.toFixed(1)}%)</span>
                      </p>
                    </div>
                    <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded p-2.5">
                      <p className="text-orange-400 text-[10px] flex items-center gap-1 opacity-70"><TrendingDown size={10} />Sell Zone</p>
                      <p className="text-orange-300 font-semibold font-mono text-xs tabular-nums mt-1">
                        ${result.sellZone.low.toFixed(2)} – ${result.sellZone.high.toFixed(2)}
                      </p>
                    </div>
                    <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded p-2.5">
                      <p className="text-[var(--down)] text-[10px] flex items-center gap-1 opacity-70"><ShieldAlert size={10} />Stop Loss</p>
                      <p className="text-red-400 font-semibold font-mono text-xs tabular-nums mt-1">
                        ${result.stopLoss.toFixed(2)}
                      </p>
                    </div>
                  </div>

                  {/* Key Forces */}
                  {result.keyForces.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[var(--text-muted)] text-[10px] uppercase tracking-wider">Key Forces:</span>
                      {result.keyForces.map((force, i) => (
                        <span key={i} className="px-2 py-0.5 rounded text-[10px] bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)]">
                          {force}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Stage trade action */}
                  {result.suggestedAction && result.suggestedAction.action !== 'HOLD' && (
                    <div className="flex items-center gap-3 p-3 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
                      <div className="flex-1">
                        <p className="text-[var(--text-primary)] text-xs font-medium">
                          Suggested: <span className={result.suggestedAction.action === 'BUY' ? 'text-[var(--up)]' : 'text-[var(--down)]'}>
                            {result.suggestedAction.action}
                          </span>
                          {' '}{ticker}
                          {result.suggestedAction.shares && ` x ${result.suggestedAction.shares} shares`}
                          {result.suggestedAction.amount && ` $${result.suggestedAction.amount}`}
                        </p>
                        <p className="text-[var(--text-muted)] text-[10px] mt-0.5">{result.suggestedAction.rationale}</p>
                      </div>
                      {staged ? (
                        <span className="px-2.5 py-1 rounded text-[10px] status-chip bg-blue-500/15 text-blue-300 border border-blue-400/20">
                          Staged
                        </span>
                      ) : (
                        <button
                          onClick={handleStage}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium bg-blue-500/15 text-blue-300 border border-blue-400/20 hover:bg-blue-500/25 hover:border-blue-400/40 transition-all"
                        >
                          <ArrowRightCircle size={12} />
                          Stage Trade
                        </button>
                      )}
                      {stagingError && <span className="text-[var(--down)] text-[10px]">{stagingError}</span>}
                    </div>
                  )}

                  {/* Disclaimer */}
                  <p className="text-[var(--text-muted)] text-[10px] leading-tight opacity-60">
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
