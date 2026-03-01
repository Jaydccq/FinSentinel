import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Wallet,
  DollarSign,
  Activity,
  TrendingUp,
  TrendingDown,
  ChevronDown,
  Send,
  Clock,
  Package,
  RefreshCw,
  Loader2,
  Sparkles,
  ShieldAlert,
  ArrowRightCircle,
  Target,
  Radio,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  okxApi,
  parseCryptoAnalysisResult,
  type OkxAccountInfo,
  type OkxPositionInfo,
  type OkxFundingRate,
  type OkxOrder,
  type CryptoAnalysisResult,
} from '../api/okx'
import { tradingApi } from '../api/trading'
import EmptyState from '../components/EmptyState'
import { useOkxPrices, type PriceSnapshot } from '../hooks/useOkxPrices'

/* ─── Helpers ─── */

function usd(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function pct(n: number) {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function pnlColor(n: number) {
  if (n > 0) return 'text-[var(--up)]'
  if (n < 0) return 'text-[var(--down)]'
  return 'text-[var(--text-muted)]'
}

function fmtDate(iso: string) {
  const d = new Date(Number(iso) || iso)
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  )
}

function fmtRate(rate: string) {
  const n = parseFloat(rate) * 100
  return `${n >= 0 ? '+' : ''}${n.toFixed(4)}%`
}

function rateColor(rate: string) {
  const n = parseFloat(rate)
  if (n > 0) return 'text-[var(--down)]' // positive = longs pay
  if (n < 0) return 'text-[var(--up)]'   // negative = shorts pay
  return 'text-[var(--text-muted)]'
}

type PositionFilter = 'ALL' | 'SPOT' | 'FUTURES'

/* ─── Recommendation / Risk Badges ─── */

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

/* ─── Watched Funding Pairs ─── */

const FUNDING_PAIRS = ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP']

/* ─── Skeleton ─── */

function CryptoSkeleton() {
  const bar = 'bg-slate-700/40 animate-pulse rounded'
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="surface-panel rounded p-3 space-y-2">
            <div className={`${bar} h-3 w-20`} />
            <div className={`${bar} h-6 w-28`} />
          </div>
        ))}
      </div>
      <div className="surface-panel rounded p-3 space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className={`${bar} h-10 w-full`} />
        ))}
      </div>
    </div>
  )
}

/* ─── Side Badge ─── */

function SideBadge({ side }: { side: string }) {
  const isLong = side.toLowerCase() === 'long' || side.toLowerCase() === 'buy'
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold border ${
        isLong
          ? 'bg-green-500/15 text-[var(--up)] border-green-400/30'
          : 'bg-red-500/15 text-[var(--down)] border-red-400/30'
      }`}
    >
      {isLong ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {side.toUpperCase()}
    </span>
  )
}

/* ─── Per-Position AI Analysis Panel ─── */

function PositionAnalysisPanel({ instId }: { instId: string }) {
  const [isRunning, setIsRunning] = useState(false)
  const [narrative, setNarrative] = useState('')
  const [result, setResult] = useState<CryptoAnalysisResult | null>(null)
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

    okxApi.streamAnalysis(
      instId,
      (chunk) => {
        setNarrative((prev) => prev + chunk)
        if (narrativeRef.current) {
          narrativeRef.current.scrollTop = narrativeRef.current.scrollHeight
        }
      },
      (_fullText, parsed) => {
        setIsRunning(false)
        if (parsed) setResult(parsed)
      },
      (err) => {
        setIsRunning(false)
        setError(err)
      },
    )
  }, [instId])

  // Auto-run on mount
  useEffect(() => {
    runAnalysis()
  }, [runAnalysis])

  const handleStage = async () => {
    if (!result?.suggestedAction || result.suggestedAction.action === 'HOLD') return
    try {
      await tradingApi.stage({
        action: result.suggestedAction.action,
        ticker: instId,
        shares: result.suggestedAction.size ?? undefined,
      })
      setStaged(true)
    } catch (e) {
      setStagingError(e instanceof Error ? e.message : 'Failed to stage trade')
    }
  }

  const displayNarrative = narrative.replace(/```json[\s\S]*?```/g, '').trim()

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="overflow-hidden"
    >
      <div className="px-4 py-3 bg-slate-900/30 border-t border-[color:var(--border-subtle)] space-y-3">
        {/* Error */}
        {error && (
          <div className="p-3 rounded bg-red-500/10 border border-red-500/20 text-[var(--down)] text-xs">
            Analysis failed: {error}
          </div>
        )}

        {/* Streaming narrative */}
        {displayNarrative && (
          <div
            ref={narrativeRef}
            className="max-h-[320px] overflow-y-auto pr-2 text-xs text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap font-mono"
            style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--border-strong) transparent' }}
          >
            {displayNarrative}
            {isRunning && <span className="inline-block w-2 h-3.5 bg-blue-400/60 animate-pulse ml-0.5" />}
          </div>
        )}

        {/* Loading state */}
        {isRunning && !displayNarrative && (
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <Loader2 size={12} className="animate-spin" />
            Analyzing {instId}...
          </div>
        )}

        {/* Structured result */}
        {result && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
            {/* Recommendation header */}
            <div className="flex items-center gap-3 flex-wrap">
              <span
                className={`px-2.5 py-1 rounded text-xs font-bold border status-chip ${REC_COLORS[result.recommendation] ?? ''}`}
              >
                {REC_LABELS[result.recommendation] ?? result.recommendation}
              </span>
              <span className="text-[var(--text-muted)] text-xs">
                Confidence:{' '}
                <span className="text-[var(--text-primary)] font-semibold">{result.confidencePercent}%</span>
              </span>
              <span className="text-[var(--text-muted)] text-xs">
                Fair Value:{' '}
                <span className="text-[var(--text-primary)] font-semibold">${result.fairValueEstimate.toFixed(2)}</span>
              </span>
              <span className={`text-xs ${RISK_COLORS[result.riskLevel] ?? 'text-[var(--text-muted)]'}`}>
                <ShieldAlert size={11} className="inline mr-1" />
                {result.riskLevel} Risk
              </span>
            </div>

            {/* Funding info */}
            {result.fundingInfo && (
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded p-2.5">
                  <p className="text-[var(--text-muted)] text-[10px]">Current Funding</p>
                  <p className={`font-semibold font-mono text-xs tabular-nums mt-1 ${result.fundingInfo.currentRate >= 0 ? 'text-[var(--down)]' : 'text-[var(--up)]'}`}>
                    {(result.fundingInfo.currentRate * 100).toFixed(4)}%
                  </p>
                </div>
                <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded p-2.5">
                  <p className="text-[var(--text-muted)] text-[10px]">Next Funding</p>
                  <p className="text-[var(--text-secondary)] font-semibold font-mono text-xs tabular-nums mt-1">
                    {(result.fundingInfo.nextRate * 100).toFixed(4)}%
                  </p>
                </div>
                <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded p-2.5">
                  <p className="text-[var(--text-muted)] text-[10px]">Daily Cost</p>
                  <p className="text-[var(--text-secondary)] font-semibold font-mono text-xs tabular-nums mt-1">
                    {usd(result.fundingInfo.dailyCost)}
                  </p>
                </div>
              </div>
            )}

            {/* Risk factors */}
            {result.riskFactors.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[var(--text-muted)] text-[10px] uppercase tracking-wider">Risks:</span>
                {result.riskFactors.map((rf, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 rounded text-[10px] bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)]"
                  >
                    {rf.description}
                  </span>
                ))}
              </div>
            )}

            {/* Stage trade action */}
            {result.suggestedAction && result.suggestedAction.action !== 'HOLD' && (
              <div className="flex items-center gap-3 p-3 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
                <div className="flex-1">
                  <p className="text-[var(--text-primary)] text-xs font-medium">
                    Suggested:{' '}
                    <span
                      className={
                        result.suggestedAction.action === 'BUY' ? 'text-[var(--up)]' : 'text-[var(--down)]'
                      }
                    >
                      {result.suggestedAction.action}
                    </span>{' '}
                    {instId}
                    {result.suggestedAction.size && ` x ${result.suggestedAction.size}`}
                    {result.suggestedAction.price && ` @ $${result.suggestedAction.price}`}
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
            {result.disclaimer && (
              <p className="text-[var(--text-muted)] text-[10px] leading-tight opacity-60">{result.disclaimer}</p>
            )}
          </motion.div>
        )}

        {/* Re-analyze button */}
        {!isRunning && (narrative || error) && (
          <button
            onClick={runAnalysis}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium bg-blue-500/15 text-blue-300 border border-blue-400/20 hover:bg-blue-500/25 hover:border-blue-400/40 transition-all"
          >
            <Sparkles size={12} />
            Re-analyze
          </button>
        )}
      </div>
    </motion.div>
  )
}

/* ─── Main Page ─── */

export default function CryptoTradingPage() {
  const [account, setAccount] = useState<OkxAccountInfo | null>(null)
  const [positions, setPositions] = useState<OkxPositionInfo[]>([])
  const [fundingRates, setFundingRates] = useState<Record<string, OkxFundingRate>>({})
  const [pendingOrders, setPendingOrders] = useState<OkxOrder[]>([])
  const [orderHistory, setOrderHistory] = useState<OkxOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)

  // Position filter
  const [posFilter, setPosFilter] = useState<PositionFilter>('ALL')
  // Expanded analysis row
  const [expandedPos, setExpandedPos] = useState<string | null>(null)

  // Quick trade form
  const [tradeInst, setTradeInst] = useState('BTC-USDT')
  const [tradeSide, setTradeSide] = useState<'BUY' | 'SELL'>('BUY')
  const [tradeSize, setTradeSize] = useState('')
  const [staging, setStaging] = useState(false)

  // Health check
  const [healthRunning, setHealthRunning] = useState(false)
  const [healthNarrative, setHealthNarrative] = useState('')
  const [healthError, setHealthError] = useState<string | null>(null)
  const healthRef = useRef<HTMLDivElement>(null)

  // Orders section
  const [ordersOpen, setOrdersOpen] = useState(false)
  const [ordersTab, setOrdersTab] = useState<'pending' | 'history'>('pending')

  // Timers
  const accountTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const fundingTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  /* ─── Real-time prices (polling) ─── */

  // Derive watched pairs from current positions so the hook only fetches what we hold
  const watchedPairs = positions.length > 0
    ? [...new Set(positions.map((p) => p.symbol))]
    : ['BTC-USDT', 'ETH-USDT', 'SOL-USDT']

  const { prices: livePrices } = useOkxPrices(watchedPairs)

  /** Return the live price for a position if available, otherwise fall back to the static mark price. */
  function resolveLivePrice(pos: OkxPositionInfo): { price: number; isLive: boolean } {
    const snap: PriceSnapshot | undefined = livePrices.get(pos.symbol)
    if (snap && snap.last > 0) return { price: snap.last, isLive: true }
    return { price: pos.currentPrice, isLive: false }
  }

  /* ─── Fetchers ─── */

  const fetchAccount = useCallback(async () => {
    try {
      const data = await okxApi.account()
      setAccount(data)
    } catch {
      // silent on auto-refresh
    }
  }, [])

  const fetchPositions = useCallback(async () => {
    try {
      const data = await okxApi.positions()
      setPositions(data)
    } catch {
      setPositions([])
    }
  }, [])

  const fetchFundingRates = useCallback(async () => {
    const results: Record<string, OkxFundingRate> = {}
    await Promise.allSettled(
      FUNDING_PAIRS.map(async (instId) => {
        try {
          const rate = await okxApi.fundingRate(instId)
          results[instId] = rate
        } catch {
          // skip failed
        }
      }),
    )
    setFundingRates(results)
  }, [])

  const fetchPendingOrders = useCallback(async () => {
    try {
      const data = await okxApi.pendingOrders()
      setPendingOrders(data)
    } catch {
      setPendingOrders([])
    }
  }, [])

  const fetchOrderHistory = useCallback(async () => {
    try {
      const data = await okxApi.orderHistory('SPOT')
      setOrderHistory(data)
    } catch {
      setOrderHistory([])
    }
  }, [])

  const syncAll = useCallback(async () => {
    setSyncing(true)
    await Promise.all([fetchAccount(), fetchPositions(), fetchFundingRates(), fetchPendingOrders(), fetchOrderHistory()])
    setSyncing(false)
  }, [fetchAccount, fetchPositions, fetchFundingRates, fetchPendingOrders, fetchOrderHistory])

  useEffect(() => {
    Promise.all([fetchAccount(), fetchPositions(), fetchFundingRates(), fetchPendingOrders(), fetchOrderHistory()]).finally(() =>
      setLoading(false),
    )

    accountTimer.current = setInterval(fetchAccount, 60_000)
    fundingTimer.current = setInterval(fetchFundingRates, 30_000)

    return () => {
      if (accountTimer.current) clearInterval(accountTimer.current)
      if (fundingTimer.current) clearInterval(fundingTimer.current)
    }
  }, [fetchAccount, fetchPositions, fetchFundingRates, fetchPendingOrders, fetchOrderHistory])

  /* ─── Actions ─── */

  const stageOrder = async () => {
    if (!tradeInst.trim() || !tradeSize.trim()) {
      toast.error('Instrument pair and size are required.')
      return
    }
    setStaging(true)
    try {
      await tradingApi.stage({
        action: tradeSide,
        ticker: tradeInst.toUpperCase(),
        shares: Number(tradeSize),
      })
      toast.success(`Staged ${tradeSide} ${tradeSize} ${tradeInst.toUpperCase()}`)
      setTradeSize('')
    } catch {
      toast.error('Failed to stage order.')
    } finally {
      setStaging(false)
    }
  }

  const runHealthCheck = () => {
    setHealthRunning(true)
    setHealthNarrative('')
    setHealthError(null)

    okxApi.streamHealthCheck(
      (chunk) => {
        setHealthNarrative((prev) => prev + chunk)
        if (healthRef.current) {
          healthRef.current.scrollTop = healthRef.current.scrollHeight
        }
      },
      () => {
        setHealthRunning(false)
      },
      (err) => {
        setHealthRunning(false)
        setHealthError(err)
      },
    )
  }

  /* ─── Derived ─── */

  const marginUsed =
    account && account.equity > 0 ? ((1 - account.buyingPower / account.equity) * 100) : 0

  const filteredPositions = positions.filter((p) => {
    if (posFilter === 'ALL') return true
    // heuristic: if symbol contains -SWAP or leverage > 0, treat as futures
    const isFutures = p.symbol.includes('-SWAP') || p.symbol.includes('FUTURES')
    return posFilter === 'FUTURES' ? isFutures : !isFutures
  })

  const healthDisplay = healthNarrative.replace(/```json[\s\S]*?```/g, '').trim()

  /* ─── Render ─── */

  if (loading) {
    return (
      <div className="px-4 py-4 md:px-8 md:py-6 space-y-4">
        <section className="glass-panel rounded p-3 md:p-4">
          <h1 className="page-title">Crypto Trading</h1>
          <p className="page-subtitle">OKX account, positions, funding rates, and AI analysis.</p>
        </section>
        <CryptoSkeleton />
      </div>
    )
  }

  return (
    <div className="px-4 py-4 md:px-8 md:py-6 space-y-4">
      {/* ─── Header ─── */}
      <section className="glass-panel rounded p-3 md:p-4 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Crypto Trading</h1>
          <p className="page-subtitle">OKX account, positions, funding rates, and AI analysis.</p>
        </div>
        <button
          onClick={syncAll}
          disabled={syncing}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium bg-blue-500/15 text-blue-300 border border-blue-400/20 hover:bg-blue-500/25 hover:border-blue-400/40 disabled:opacity-50 transition-all"
        >
          <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Syncing...' : 'Sync All'}
        </button>
      </section>

      {/* ─── Section 1: Account Overview ─── */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {
            label: 'Total Equity',
            value: usd(account?.equity ?? 0),
            icon: <Wallet size={16} />,
            accent: 'text-cyan-200',
          },
          {
            label: 'Available Balance',
            value: usd(account?.buyingPower ?? 0),
            icon: <DollarSign size={16} />,
            accent: 'text-blue-200',
          },
          {
            label: 'Margin Used',
            value: null, // custom render
            icon: <Activity size={16} />,
            accent: 'text-yellow-200',
          },
          {
            label: 'Unrealized PnL',
            value: usd(account?.unrealizedPnL ?? 0),
            icon: <TrendingUp size={16} />,
            accent: pnlColor(account?.unrealizedPnL ?? 0),
          },
        ].map((card, i) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: i * 0.06 }}
            className="surface-panel rounded p-3 md:p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                {card.label}
              </span>
              <span className="text-[var(--text-muted)]">{card.icon}</span>
            </div>
            {card.label === 'Margin Used' ? (
              <div>
                <p className="kpi-value text-yellow-200 mb-1">{marginUsed.toFixed(1)}%</p>
                <div className="w-full h-1.5 rounded-full bg-slate-700/50 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      marginUsed > 80
                        ? 'bg-red-500'
                        : marginUsed > 50
                          ? 'bg-yellow-500'
                          : 'bg-blue-500'
                    }`}
                    style={{ width: `${Math.min(marginUsed, 100)}%` }}
                  />
                </div>
              </div>
            ) : (
              <p className={`kpi-value ${card.accent}`}>{card.value}</p>
            )}
          </motion.div>
        ))}
      </section>

      {/* ─── Section 2: Positions Table ─── */}
      <motion.section
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.12 }}
        className="surface-panel rounded overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-[color:var(--border-subtle)] flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Positions</h2>
          <div className="flex gap-1">
            {(['ALL', 'SPOT', 'FUTURES'] as PositionFilter[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setPosFilter(tab)}
                className={`px-3 py-1 rounded text-xs font-medium border transition-colors ${
                  posFilter === tab
                    ? 'bg-blue-500/20 border-blue-400/30 text-blue-300'
                    : 'bg-transparent border-[color:var(--border-subtle)] text-[var(--text-muted)] hover:border-[color:var(--border-strong)]'
                }`}
              >
                {tab === 'ALL' ? 'All' : tab === 'SPOT' ? 'Spot' : 'Futures'}
              </button>
            ))}
          </div>
        </div>

        {filteredPositions.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={<Package size={24} />}
              title="No open positions"
              description={posFilter !== 'ALL' ? `No ${posFilter.toLowerCase()} positions found.` : 'Your OKX positions will appear here.'}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-terminal w-full min-w-[720px]">
              <thead>
                <tr className="bg-slate-900/35 text-[var(--text-muted)] text-xs border-b border-[color:var(--border-subtle)]">
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-[0.08em]">Pair</th>
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-[0.08em]">Side</th>
                  <th className="px-3 py-2 text-right font-semibold uppercase tracking-[0.08em]">Size</th>
                  <th className="px-3 py-2 text-right font-semibold uppercase tracking-[0.08em]">Entry</th>
                  <th className="px-3 py-2 text-right font-semibold uppercase tracking-[0.08em]">Mark</th>
                  <th className="px-3 py-2 text-right font-semibold uppercase tracking-[0.08em]">PnL ($)</th>
                  <th className="px-3 py-2 text-right font-semibold uppercase tracking-[0.08em]">PnL (%)</th>
                  <th className="px-3 py-2 text-center font-semibold uppercase tracking-[0.08em]">AI</th>
                </tr>
              </thead>
              <tbody>
                {filteredPositions.map((pos, idx) => {
                  const { price: markPrice, isLive } = resolveLivePrice(pos)
                  const livePnl = pos.side.toLowerCase() === 'short' || pos.side.toLowerCase() === 'sell'
                    ? (pos.avgEntryPrice - markPrice) * pos.qty
                    : (markPrice - pos.avgEntryPrice) * pos.qty
                  const pnlPct =
                    pos.avgEntryPrice > 0
                      ? ((markPrice - pos.avgEntryPrice) / pos.avgEntryPrice) * 100
                      : 0
                  const displayPnl = isLive ? livePnl : pos.unrealizedPnL
                  const isExpanded = expandedPos === pos.symbol

                  return (
                    <tr key={pos.symbol}>
                      <td colSpan={8} className="p-0">
                        <div>
                          <div
                            className={`grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto_auto] items-center border-b border-[color:var(--border-subtle)] hover:bg-white/5 transition-colors ${
                              idx % 2 === 1 ? 'bg-slate-900/15' : ''
                            }`}
                          >
                            <span className="px-3 py-2 font-data font-bold text-blue-100">{pos.symbol}</span>
                            <span className="px-3 py-2">
                              <SideBadge side={pos.side} />
                            </span>
                            <span className="px-3 py-2 text-right text-[var(--text-secondary)] font-data tabular-nums min-w-[80px]">
                              {pos.qty}
                            </span>
                            <span className="px-3 py-2 text-right text-[var(--text-secondary)] font-data tabular-nums min-w-[90px]">
                              {usd(pos.avgEntryPrice)}
                            </span>
                            <span className="px-3 py-2 text-right font-data tabular-nums min-w-[90px] flex items-center justify-end gap-1.5">
                              <span className="text-[var(--text-secondary)]">{usd(markPrice)}</span>
                              {isLive && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-400/25">
                                  <Radio size={8} className="animate-pulse" />
                                  Live
                                </span>
                              )}
                            </span>
                            <span
                              className={`px-3 py-2 text-right font-data tabular-nums font-semibold min-w-[90px] ${pnlColor(displayPnl)}`}
                            >
                              {usd(displayPnl)}
                            </span>
                            <span
                              className={`px-3 py-2 text-right font-data tabular-nums font-semibold min-w-[80px] ${pnlColor(pnlPct)}`}
                            >
                              {pct(pnlPct)}
                            </span>
                            <span className="px-3 py-2 text-center min-w-[50px]">
                              <button
                                onClick={() => setExpandedPos(isExpanded ? null : pos.symbol)}
                                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border transition-all ${
                                  isExpanded
                                    ? 'bg-blue-500/25 border-blue-400/40 text-blue-300'
                                    : 'bg-blue-500/10 border-blue-400/20 text-blue-400 hover:bg-blue-500/20'
                                }`}
                              >
                                <Sparkles size={11} />
                                AI
                              </button>
                            </span>
                          </div>

                          <AnimatePresence>
                            {isExpanded && <PositionAnalysisPanel instId={pos.symbol} />}
                          </AnimatePresence>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </motion.section>

      {/* ─── Section 3: Quick Trade + Funding Rates ─── */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Quick Trade Form */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.18 }}
          className="surface-panel rounded p-3 md:p-4"
        >
          <h2 className="text-base font-semibold text-[var(--text-primary)] mb-3">Quick Trade</h2>
          <div className="space-y-3">
            {/* Instrument Pair */}
            <div>
              <label htmlFor="crypto-inst" className="field-label">
                Instrument Pair
              </label>
              <input
                id="crypto-inst"
                type="text"
                className="field-input uppercase"
                placeholder="BTC-USDT"
                value={tradeInst}
                onChange={(e) => setTradeInst(e.target.value.toUpperCase())}
              />
            </div>

            {/* Side Toggle */}
            <div>
              <label className="field-label">Side</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setTradeSide('BUY')}
                  className={`flex-1 py-2 rounded text-sm font-bold border transition-colors ${
                    tradeSide === 'BUY'
                      ? 'bg-green-500/20 border-green-400/40 text-[var(--up)]'
                      : 'bg-transparent border-[color:var(--border-subtle)] text-[var(--text-muted)] hover:border-[color:var(--border-strong)]'
                  }`}
                >
                  BUY
                </button>
                <button
                  onClick={() => setTradeSide('SELL')}
                  className={`flex-1 py-2 rounded text-sm font-bold border transition-colors ${
                    tradeSide === 'SELL'
                      ? 'bg-red-500/20 border-red-400/40 text-[var(--down)]'
                      : 'bg-transparent border-[color:var(--border-subtle)] text-[var(--text-muted)] hover:border-[color:var(--border-strong)]'
                  }`}
                >
                  SELL
                </button>
              </div>
            </div>

            {/* Size */}
            <div>
              <label htmlFor="crypto-size" className="field-label">
                Size
              </label>
              <input
                id="crypto-size"
                type="number"
                className="field-input"
                placeholder="0.01"
                min={0}
                step="any"
                value={tradeSize}
                onChange={(e) => setTradeSize(e.target.value)}
              />
            </div>

            {/* Stage button */}
            <button
              onClick={stageOrder}
              disabled={staging || !tradeInst.trim() || !tradeSize.trim()}
              className="btn-primary w-full py-2 text-sm disabled:opacity-40"
            >
              <Send size={14} />
              {staging ? 'Staging...' : 'Stage Order'}
            </button>
          </div>
        </motion.div>

        {/* Funding Rates */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.24 }}
          className="surface-panel rounded p-3 md:p-4"
        >
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-[var(--text-primary)]">Funding Rates</h2>
            <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Auto-refresh 30s</span>
          </div>

          {FUNDING_PAIRS.map((instId) => {
            const rate = fundingRates[instId]
            return (
              <div
                key={instId}
                className="flex items-center justify-between py-2.5 border-b border-[color:var(--border-subtle)] last:border-b-0"
              >
                <div className="flex items-center gap-2">
                  <Target size={13} className="text-[var(--text-muted)]" />
                  <span className="text-sm font-data font-medium text-[var(--text-primary)]">{instId}</span>
                </div>
                {rate ? (
                  <div className="text-right space-y-0.5">
                    <div className="flex items-center gap-3">
                      <div>
                        <p className="text-[10px] text-[var(--text-muted)]">Current</p>
                        <p className={`text-xs font-data font-semibold tabular-nums ${rateColor(rate.fundingRate)}`}>
                          {fmtRate(rate.fundingRate)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[var(--text-muted)]">Next Est.</p>
                        <p className="text-xs font-data font-semibold tabular-nums text-[var(--text-secondary)]">
                          {fmtRate(rate.nextFundingRate)}
                        </p>
                      </div>
                    </div>
                    <p className="text-[10px] text-[var(--text-muted)]">
                      Next:{' '}
                      {new Date(Number(rate.nextFundingTime)).toLocaleTimeString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                ) : (
                  <span className="text-xs text-[var(--text-muted)]">Loading...</span>
                )}
              </div>
            )
          })}

          {/* Daily funding cost total estimate */}
          {Object.keys(fundingRates).length > 0 && (
            <div className="mt-3 pt-3 border-t border-[color:var(--border-subtle)]">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)]">Avg Daily Funding (3x/day)</span>
                <span className="text-xs font-data font-semibold text-[var(--text-secondary)] tabular-nums">
                  {(() => {
                    const avg =
                      Object.values(fundingRates).reduce((sum, r) => sum + Math.abs(parseFloat(r.fundingRate)), 0) /
                      Object.values(fundingRates).length
                    return `${(avg * 3 * 100).toFixed(4)}%`
                  })()}
                </span>
              </div>
            </div>
          )}
        </motion.div>
      </section>

      {/* ─── Section 4: AI Portfolio Health Check ─── */}
      <motion.section
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="surface-panel rounded overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--border-subtle)]">
          <div className="flex items-center gap-3">
            <span className="w-[2px] h-4 bg-purple-500 inline-block" />
            <Sparkles size={14} className="text-purple-400" />
            <h2 className="text-base font-semibold text-[var(--text-primary)]">AI Portfolio Health Check</h2>
          </div>
          <button
            onClick={runHealthCheck}
            disabled={healthRunning}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium bg-purple-500/15 text-purple-300 border border-purple-400/20 hover:bg-purple-500/25 hover:border-purple-400/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {healthRunning ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Sparkles size={12} />
                Run Health Check
              </>
            )}
          </button>
        </div>

        <div className="px-4 py-3">
          {healthError && (
            <div className="p-3 rounded bg-red-500/10 border border-red-500/20 text-[var(--down)] text-xs mb-3">
              Health check failed: {healthError}
            </div>
          )}

          {healthDisplay ? (
            <div
              ref={healthRef}
              className="max-h-[480px] overflow-y-auto pr-2 text-xs text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap font-mono"
              style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--border-strong) transparent' }}
            >
              {healthDisplay}
              {healthRunning && <span className="inline-block w-2 h-3.5 bg-purple-400/60 animate-pulse ml-0.5" />}
            </div>
          ) : !healthRunning ? (
            <p className="text-sm text-[var(--text-muted)] text-center py-4">
              Click "Run Health Check" to analyze your crypto portfolio.
            </p>
          ) : (
            <div className="flex items-center gap-2 text-sm text-[var(--text-muted)] py-4 justify-center">
              <Loader2 size={14} className="animate-spin" />
              Analyzing your portfolio health...
            </div>
          )}
        </div>
      </motion.section>

      {/* ─── Section 5: Recent Orders (collapsible) ─── */}
      <motion.section
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.36 }}
        className="surface-panel rounded overflow-hidden"
      >
        <button
          onClick={() => setOrdersOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-[var(--text-primary)]">Recent Orders</h2>
            {pendingOrders.length > 0 && (
              <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded text-xs font-bold bg-yellow-500/20 text-yellow-300 border border-yellow-400/30">
                {pendingOrders.length}
              </span>
            )}
          </div>
          <ChevronDown
            size={16}
            className="text-[var(--text-muted)] transition-transform duration-200"
            style={{ transform: ordersOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
          />
        </button>

        <AnimatePresence initial={false}>
          {ordersOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="border-t border-[color:var(--border-subtle)]">
                {/* Tab toggle */}
                <div className="flex gap-1 px-4 pt-3 pb-2">
                  <button
                    onClick={() => setOrdersTab('pending')}
                    className={`px-3 py-1 rounded text-xs font-medium border transition-colors ${
                      ordersTab === 'pending'
                        ? 'bg-yellow-500/20 border-yellow-400/30 text-yellow-300'
                        : 'bg-transparent border-[color:var(--border-subtle)] text-[var(--text-muted)] hover:border-[color:var(--border-strong)]'
                    }`}
                  >
                    Pending ({pendingOrders.length})
                  </button>
                  <button
                    onClick={() => setOrdersTab('history')}
                    className={`px-3 py-1 rounded text-xs font-medium border transition-colors ${
                      ordersTab === 'history'
                        ? 'bg-blue-500/20 border-blue-400/30 text-blue-300'
                        : 'bg-transparent border-[color:var(--border-subtle)] text-[var(--text-muted)] hover:border-[color:var(--border-strong)]'
                    }`}
                  >
                    Filled History
                  </button>
                </div>

                {/* Orders table */}
                {(() => {
                  const orders = ordersTab === 'pending' ? pendingOrders : orderHistory
                  if (orders.length === 0) {
                    return (
                      <div className="p-4">
                        <EmptyState
                          icon={<Clock size={24} />}
                          title={ordersTab === 'pending' ? 'No pending orders' : 'No order history'}
                          description={
                            ordersTab === 'pending'
                              ? 'Pending orders will appear here.'
                              : 'Filled orders will appear here.'
                          }
                        />
                      </div>
                    )
                  }

                  return (
                    <div className="overflow-x-auto">
                      <table className="table-terminal w-full min-w-[640px]">
                        <thead>
                          <tr className="bg-slate-900/35 text-[var(--text-muted)] text-xs border-b border-[color:var(--border-subtle)]">
                            <th className="px-3 py-2 text-left font-semibold uppercase tracking-[0.08em]">Time</th>
                            <th className="px-3 py-2 text-left font-semibold uppercase tracking-[0.08em]">Pair</th>
                            <th className="px-3 py-2 text-left font-semibold uppercase tracking-[0.08em]">Side</th>
                            <th className="px-3 py-2 text-left font-semibold uppercase tracking-[0.08em]">Type</th>
                            <th className="px-3 py-2 text-right font-semibold uppercase tracking-[0.08em]">Size</th>
                            <th className="px-3 py-2 text-right font-semibold uppercase tracking-[0.08em]">Price</th>
                            <th className="px-3 py-2 text-left font-semibold uppercase tracking-[0.08em]">Status</th>
                            <th className="px-3 py-2 text-right font-semibold uppercase tracking-[0.08em]">PnL</th>
                          </tr>
                        </thead>
                        <tbody>
                          {orders.map((order, idx) => {
                            const pnlNum = parseFloat(order.pnl || '0')
                            return (
                              <tr
                                key={order.ordId}
                                className={`border-b border-[color:var(--border-subtle)] hover:bg-white/5 transition-colors ${
                                  idx % 2 === 1 ? 'bg-slate-900/15' : ''
                                }`}
                              >
                                <td className="px-3 py-2 text-xs text-[var(--text-muted)] font-data tabular-nums whitespace-nowrap">
                                  {fmtDate(order.cTime)}
                                </td>
                                <td className="px-3 py-2 font-data font-bold text-blue-100 text-sm">
                                  {order.instId}
                                </td>
                                <td className="px-3 py-2">
                                  <SideBadge side={order.side} />
                                </td>
                                <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">
                                  {order.ordType.toUpperCase()}
                                </td>
                                <td className="px-3 py-2 text-right text-[var(--text-secondary)] font-data tabular-nums text-sm">
                                  {order.accFillSz || order.sz}
                                </td>
                                <td className="px-3 py-2 text-right text-[var(--text-secondary)] font-data tabular-nums text-sm">
                                  {order.avgPx && parseFloat(order.avgPx) > 0
                                    ? `$${parseFloat(order.avgPx).toFixed(2)}`
                                    : order.px && parseFloat(order.px) > 0
                                      ? `$${parseFloat(order.px).toFixed(2)}`
                                      : '-'}
                                </td>
                                <td className="px-3 py-2">
                                  <span
                                    className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${
                                      order.state === 'filled'
                                        ? 'bg-green-500/15 text-[var(--up)] border-green-400/30'
                                        : order.state === 'canceled' || order.state === 'cancelled'
                                          ? 'bg-red-500/15 text-[var(--down)] border-red-400/30'
                                          : 'bg-yellow-500/15 text-yellow-300 border-yellow-400/30'
                                    }`}
                                  >
                                    {order.state.toUpperCase()}
                                  </span>
                                </td>
                                <td
                                  className={`px-3 py-2 text-right font-data tabular-nums text-sm font-semibold ${pnlColor(pnlNum)}`}
                                >
                                  {pnlNum !== 0 ? usd(pnlNum) : '-'}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )
                })()}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.section>
    </div>
  )
}
