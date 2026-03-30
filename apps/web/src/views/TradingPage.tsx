'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Wallet,
  TrendingUp,
  DollarSign,
  Activity,
  ChevronDown,
  Send,
  Clock,
  Hash,
  Package,
  ArrowUpRight,
  ArrowDownRight,
  Bitcoin,
  RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  tradingApiV2,
  type V2WalletStatus,
  type V2StagedOrders,
  type V2TradeCommit,
  type V2TradeOperation,
  type AssetSearchResult,
} from '../api/trading'
import { okxApi, type OkxAccountInfo, type OkxPositionInfo } from '../api/okx'
import EmptyState from '../components/EmptyState'

type TradingTab = 'paper' | 'okx'

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

function truncHash(hash: string) {
  return hash.slice(0, 8)
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

/* ─── Skeleton ─── */

function TradingSkeleton() {
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="surface-panel rounded p-3 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`${bar} h-8 w-full`} />
          ))}
        </div>
        <div className="surface-panel rounded p-3 space-y-2">
          <div className={`${bar} h-8 w-full`} />
          <div className={`${bar} h-8 w-full`} />
          <div className={`${bar} h-8 w-full`} />
          <div className={`${bar} h-9 w-full`} />
        </div>
      </div>
    </div>
  )
}

/* ─── Action Badge ─── */

function ActionBadge({ action }: { action: string }) {
  const isBuy = action.toUpperCase() === 'BUY'
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold border ${
        isBuy
          ? 'bg-green-500/15 text-[var(--up)] border-green-400/30'
          : 'bg-red-500/15 text-[var(--down)] border-red-400/30'
      }`}
    >
      {isBuy ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
      {action.toUpperCase()}
    </span>
  )
}

/* ─── Main Page ─── */

export default function TradingPage() {
  // Tab state
  const [activeTab, setActiveTab] = useState<TradingTab>('paper')

  const [wallet, setWallet] = useState<V2WalletStatus | null>(null)
  const [staged, setStaged] = useState<V2StagedOrders | null>(null)
  const [history, setHistory] = useState<V2TradeCommit[]>([])
  const [loading, setLoading] = useState(true)

  // Order form
  const [action, setAction] = useState<'BUY' | 'SELL'>('BUY')
  const [symbol, setSymbol] = useState('')
  const [qty, setQty] = useState('')
  const [amount, setAmount] = useState('')
  const [orderMode, setOrderMode] = useState<'qty' | 'amount'>('qty')
  const [staging, setStaging] = useState(false)

  // Asset search
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<AssetSearchResult[]>([])
  const [searching, setSearching] = useState(false)

  // Commit form
  const [commitMsg, setCommitMsg] = useState('')
  const [committing, setCommitting] = useState(false)

  // Collapsible sections
  const [stagedOpen, setStagedOpen] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(true)
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null)

  // OKX state
  const [okxAccount, setOkxAccount] = useState<OkxAccountInfo | null>(null)
  const [okxPositions, setOkxPositions] = useState<OkxPositionInfo[]>([])
  const [okxLoading, setOkxLoading] = useState(false)
  const [okxAction, setOkxAction] = useState<'BUY' | 'SELL'>('BUY')
  const [okxInstId, setOkxInstId] = useState('')
  const [okxQty, setOkxQty] = useState('')
  const [okxStaging, setOkxStaging] = useState(false)
  const [okxStagedOpen, setOkxStagedOpen] = useState(true)

  const walletTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const okxTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  /* ─── Fetchers ─── */

  const fetchWallet = useCallback(async () => {
    try {
      const data = await tradingApiV2.wallet()
      setWallet(data)
    } catch {
      // silent on auto-refresh
    }
  }, [])

  const fetchStaged = useCallback(async () => {
    try {
      const data = await tradingApiV2.staged()
      setStaged(data)
    } catch {
      setStaged({ operations: [], count: 0 })
    }
  }, [])

  const fetchHistory = useCallback(async () => {
    try {
      const data = await tradingApiV2.history(10)
      setHistory(data)
    } catch {
      setHistory([])
    }
  }, [])

  const fetchOkxData = useCallback(async () => {
    try {
      const [account, positions] = await Promise.all([
        okxApi.account(),
        okxApi.positions(),
      ])
      setOkxAccount(account)
      setOkxPositions(positions)
    } catch {
      // silent on auto-refresh
    }
  }, [])

  useEffect(() => {
    Promise.all([fetchWallet(), fetchStaged(), fetchHistory()])
      .finally(() => setLoading(false))

    walletTimer.current = setInterval(fetchWallet, 60_000)
    return () => {
      if (walletTimer.current) clearInterval(walletTimer.current)
    }
  }, [fetchWallet, fetchStaged, fetchHistory])

  // Fetch OKX data when switching to OKX tab, auto-refresh every 60s
  useEffect(() => {
    if (activeTab !== 'okx') {
      if (okxTimer.current) clearInterval(okxTimer.current)
      okxTimer.current = null
      return
    }
    setOkxLoading(true)
    Promise.all([fetchOkxData(), fetchStaged()])
      .finally(() => setOkxLoading(false))

    okxTimer.current = setInterval(fetchOkxData, 60_000)
    return () => {
      if (okxTimer.current) clearInterval(okxTimer.current)
    }
  }, [activeTab, fetchOkxData, fetchStaged])

  /* ─── Actions ─── */

  const stageOrder = async () => {
    const sym = symbol.trim().toUpperCase()
    if (!sym) {
      toast.error('Symbol is required.')
      return
    }
    if (orderMode === 'qty' && !qty.trim()) {
      toast.error('Quantity is required.')
      return
    }
    if (orderMode === 'amount' && !amount.trim()) {
      toast.error('Dollar amount is required.')
      return
    }
    setStaging(true)
    try {
      await tradingApiV2.stage({
        action,
        symbol: sym,
        ...(orderMode === 'qty' ? { qty: qty.trim() } : { amount: amount.trim() }),
      })
      const label = orderMode === 'qty' ? `${qty} units` : `$${amount}`
      toast.success(`Staged ${action} ${label} of ${sym}`)
      setSymbol('')
      setQty('')
      setAmount('')
      await fetchStaged()
    } catch {
      toast.error('Failed to stage order.')
    } finally {
      setStaging(false)
    }
  }

  const commitAndExecute = async () => {
    if (!commitMsg.trim()) {
      toast.error('Commit message is required.')
      return
    }
    setCommitting(true)
    try {
      await tradingApiV2.commit(commitMsg)
      const result = await tradingApiV2.execute()
      toast.success(
        `Executed ${result.operations.length} operation${result.operations.length !== 1 ? 's' : ''} — ${truncHash(result.hash)}`,
      )
      setCommitMsg('')
      await Promise.all([fetchWallet(), fetchStaged(), fetchHistory()])
    } catch {
      toast.error('Commit or execution failed.')
    } finally {
      setCommitting(false)
    }
  }

  const stageOkxOrder = async () => {
    if (!okxInstId.trim() || !okxQty.trim()) {
      toast.error('Instrument ID and quantity are required.')
      return
    }
    setOkxStaging(true)
    try {
      await tradingApiV2.stage({
        action: okxAction,
        symbol: okxInstId.toUpperCase(),
        qty: okxQty.trim(),
      })
      toast.success(`Staged ${okxAction} ${okxQty} ${okxInstId.toUpperCase()}`)
      setOkxInstId('')
      setOkxQty('')
      await fetchStaged()
    } catch {
      toast.error('Failed to stage order.')
    } finally {
      setOkxStaging(false)
    }
  }

  // Asset search handler
  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query)
    if (query.trim().length < 2) {
      setSearchResults([])
      return
    }
    setSearching(true)
    try {
      const results = await tradingApiV2.search(query.trim())
      setSearchResults(results)
    } catch {
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }, [])

  /* ─── Render ─── */

  if (loading) {
    return (
      <div className="px-4 py-4 md:px-8 md:py-6 space-y-4">
        <section className="glass-panel rounded p-3 md:p-4">
          <h1 className="page-title">Trading Desk</h1>
          <p className="page-subtitle">Stage, commit, and execute paper or live trades.</p>
        </section>
        <TradingSkeleton />
      </div>
    )
  }

  const positions = wallet?.positions ?? []
  const stagedOps: V2TradeOperation[] = staged?.operations ?? []
  const isPaper = wallet?.tradingMode?.toUpperCase() !== 'LIVE'

  return (
    <div className="px-4 py-4 md:px-8 md:py-6 space-y-4">
      {/* ─── Header ─── */}
      <section className="glass-panel rounded p-3 md:p-4 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Trading Desk</h1>
          <p className="page-subtitle">Stage, commit, and execute paper or live trades.</p>
        </div>
      </section>

      {/* ─── Tab Bar ─── */}
      <div className="bg-white/5 backdrop-blur-sm rounded-xl p-1 flex gap-1">
        <button
          onClick={() => setActiveTab('paper')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            activeTab === 'paper'
              ? 'bg-white/10 text-[var(--text-primary)] shadow-sm'
              : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-white/5'
          }`}
        >
          <DollarSign size={15} />
          Paper Trading
        </button>
        <button
          onClick={() => setActiveTab('okx')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            activeTab === 'okx'
              ? 'bg-white/10 text-[var(--text-primary)] shadow-sm'
              : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-white/5'
          }`}
        >
          <Bitcoin size={15} />
          OKX Crypto
        </button>
      </div>

      {/* ─── Paper Trading Tab ─── */}
      {activeTab === 'paper' && (
        <>
          {/* ─── Section 1: Wallet Overview ─── */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              {
                label: 'Cash Balance',
                value: usd(wallet?.cashBalance ?? 0),
                icon: <DollarSign size={16} />,
                accent: 'text-blue-200',
              },
              {
                label: 'Total Value',
                value: usd(wallet?.totalValue ?? 0),
                icon: <Wallet size={16} />,
                accent: 'text-cyan-200',
              },
              {
                label: 'Total Return',
                value: pct(wallet?.returnPercent ?? 0),
                icon: <TrendingUp size={16} />,
                accent: pnlColor(wallet?.returnPercent ?? 0),
              },
              {
                label: 'Trading Mode',
                value: isPaper ? 'PAPER' : 'LIVE',
                icon: <Activity size={16} />,
                accent: isPaper ? 'text-cyan-300' : 'text-[var(--down)]',
                badge: true,
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
                {card.badge ? (
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-xs font-bold border ${
                      isPaper
                        ? 'bg-cyan-500/15 border-cyan-400/30 text-cyan-300'
                        : 'bg-red-500/15 border-red-400/30 text-[var(--down)]'
                    }`}
                  >
                    {card.value}
                  </span>
                ) : (
                  <p className={`kpi-value ${card.accent}`}>{card.value}</p>
                )}
              </motion.div>
            ))}
          </section>

          {/* ─── Asset Search ─── */}
          <motion.section
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.08 }}
            className="surface-panel rounded p-3 md:p-4"
          >
            <h2 className="text-base font-semibold text-[var(--text-primary)] mb-2">Asset Search</h2>
            <div className="flex gap-2">
              <input
                type="text"
                className="field-input flex-1"
                placeholder="Search stocks, crypto, derivatives..."
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
              />
              {searching && (
                <span className="flex items-center text-xs text-[var(--text-muted)]">
                  <RefreshCw size={12} className="animate-spin mr-1" />
                  Searching...
                </span>
              )}
            </div>
            {searchResults.length > 0 && (
              <div className="mt-2 max-h-[180px] overflow-y-auto divide-y divide-[color:var(--border-subtle)] border border-[color:var(--border-subtle)] rounded">
                {searchResults.map((asset) => (
                  <button
                    key={asset.symbol}
                    onClick={() => {
                      setSymbol(asset.symbol)
                      setSearchQuery('')
                      setSearchResults([])
                    }}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2 hover:bg-white/5 transition-colors text-left"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-data font-bold text-blue-100 text-sm">{asset.symbol}</span>
                      {asset.name && (
                        <span className="text-xs text-[var(--text-muted)] truncate">{asset.name}</span>
                      )}
                    </div>
                    {asset.securityType && (
                      <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-700/50 text-[var(--text-secondary)] border border-[color:var(--border-subtle)]">
                        {asset.securityType}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </motion.section>

          {/* ─── Section 2: Positions + Order Form ─── */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Positions Table */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.12 }}
              className="surface-panel rounded overflow-hidden"
            >
              <div className="px-4 py-3 border-b border-[color:var(--border-subtle)]">
                <h2 className="text-base font-semibold text-[var(--text-primary)]">Open Positions</h2>
              </div>
              {positions.length === 0 ? (
                <div className="p-4">
                  <EmptyState
                    icon={<Package size={24} />}
                    title="No open positions"
                    description="Execute a buy order to open a position."
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table-terminal w-full min-w-[540px]">
                    <thead>
                      <tr className="bg-slate-900/35 text-[var(--text-muted)] text-xs border-b border-[color:var(--border-subtle)]">
                        <th className="px-3 py-2 text-left font-semibold uppercase tracking-[0.08em]">Symbol</th>
                        <th className="px-3 py-2 text-right font-semibold uppercase tracking-[0.08em]">Qty</th>
                        <th className="px-3 py-2 text-right font-semibold uppercase tracking-[0.08em]">Avg Cost</th>
                        <th className="px-3 py-2 text-right font-semibold uppercase tracking-[0.08em]">Current</th>
                        <th className="px-3 py-2 text-right font-semibold uppercase tracking-[0.08em]">P&L</th>
                        <th className="px-3 py-2 text-right font-semibold uppercase tracking-[0.08em]">P&L %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map((pos, idx) => (
                        <tr
                          key={pos.symbol}
                          className={`border-b border-[color:var(--border-subtle)] hover:bg-white/5 transition-colors ${
                            idx % 2 === 1 ? 'bg-slate-900/15' : ''
                          }`}
                        >
                          <td className="px-3 py-2 font-data font-bold text-blue-100">{pos.symbol}</td>
                          <td className="px-3 py-2 text-right text-[var(--text-secondary)] font-data tabular-nums">
                            {pos.qty}
                          </td>
                          <td className="px-3 py-2 text-right text-[var(--text-secondary)] font-data tabular-nums">
                            {usd(pos.avgCost)}
                          </td>
                          <td className="px-3 py-2 text-right text-[var(--text-secondary)] font-data tabular-nums">
                            {usd(pos.currentPrice)}
                          </td>
                          <td className={`px-3 py-2 text-right font-data tabular-nums font-semibold ${pnlColor(pos.unrealizedPnl)}`}>
                            {usd(pos.unrealizedPnl)}
                          </td>
                          <td className={`px-3 py-2 text-right font-data tabular-nums font-semibold ${pnlColor(pos.pnlPercent)}`}>
                            {pct(pos.pnlPercent)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </motion.div>

            {/* Order Form */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.18 }}
              className="surface-panel rounded p-3 md:p-4"
            >
              <h2 className="text-base font-semibold text-[var(--text-primary)] mb-3">New Order</h2>
              <div className="space-y-3">
                {/* Action Toggle */}
                <div>
                  <label className="field-label">Action</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setAction('BUY')}
                      className={`flex-1 py-2 rounded text-sm font-bold border transition-colors ${
                        action === 'BUY'
                          ? 'bg-green-500/20 border-green-400/40 text-[var(--up)]'
                          : 'bg-transparent border-[color:var(--border-subtle)] text-[var(--text-muted)] hover:border-[color:var(--border-strong)]'
                      }`}
                    >
                      BUY
                    </button>
                    <button
                      onClick={() => setAction('SELL')}
                      className={`flex-1 py-2 rounded text-sm font-bold border transition-colors ${
                        action === 'SELL'
                          ? 'bg-red-500/20 border-red-400/40 text-[var(--down)]'
                          : 'bg-transparent border-[color:var(--border-subtle)] text-[var(--text-muted)] hover:border-[color:var(--border-strong)]'
                      }`}
                    >
                      SELL
                    </button>
                  </div>
                </div>

                {/* Symbol */}
                <div>
                  <label htmlFor="order-symbol" className="field-label">Symbol</label>
                  <input
                    id="order-symbol"
                    type="text"
                    className="field-input uppercase"
                    placeholder="AAPL, BTC-USDT-SWAP, BTC/USD"
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  />
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">
                    Stocks, crypto pairs, or derivatives (e.g. AAPL, BTC-USDT, ETH-USDT-SWAP)
                  </p>
                </div>

                {/* Qty / Amount Toggle */}
                <div>
                  <label className="field-label">Order By</label>
                  <div className="flex gap-2 mb-2">
                    <button
                      onClick={() => setOrderMode('qty')}
                      className={`flex-1 py-1.5 rounded text-xs font-semibold border transition-colors ${
                        orderMode === 'qty'
                          ? 'bg-blue-500/20 border-blue-400/40 text-blue-300'
                          : 'bg-transparent border-[color:var(--border-subtle)] text-[var(--text-muted)] hover:border-[color:var(--border-strong)]'
                      }`}
                    >
                      Quantity
                    </button>
                    <button
                      onClick={() => setOrderMode('amount')}
                      className={`flex-1 py-1.5 rounded text-xs font-semibold border transition-colors ${
                        orderMode === 'amount'
                          ? 'bg-blue-500/20 border-blue-400/40 text-blue-300'
                          : 'bg-transparent border-[color:var(--border-subtle)] text-[var(--text-muted)] hover:border-[color:var(--border-strong)]'
                      }`}
                    >
                      $ Amount
                    </button>
                  </div>
                  {orderMode === 'qty' ? (
                    <input
                      id="order-qty"
                      type="number"
                      className="field-input"
                      placeholder="100"
                      min={0}
                      step="any"
                      value={qty}
                      onChange={(e) => setQty(e.target.value)}
                    />
                  ) : (
                    <input
                      id="order-amount"
                      type="number"
                      className="field-input"
                      placeholder="1000.00"
                      min={0}
                      step="any"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  )}
                </div>

                {/* Stage button */}
                <button
                  onClick={stageOrder}
                  disabled={staging || !symbol.trim() || (orderMode === 'qty' ? !qty.trim() : !amount.trim())}
                  className="btn-primary w-full py-2 text-sm disabled:opacity-40"
                >
                  <Send size={14} />
                  {staging ? 'Staging...' : 'Stage Order'}
                </button>
              </div>
            </motion.div>
          </section>

          {/* ─── Section 3: Staged Orders ─── */}
          <motion.section
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.24 }}
            className="surface-panel rounded overflow-hidden"
          >
            <button
              onClick={() => setStagedOpen((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-3">
                <h2 className="text-base font-semibold text-[var(--text-primary)]">Staged Orders</h2>
                {stagedOps.length > 0 && (
                  <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded text-xs font-bold bg-blue-500/20 text-blue-300 border border-blue-400/30">
                    {stagedOps.length}
                  </span>
                )}
              </div>
              <ChevronDown
                size={16}
                className="text-[var(--text-muted)] transition-transform duration-200"
                style={{ transform: stagedOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
              />
            </button>

            <AnimatePresence initial={false}>
              {stagedOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="border-t border-[color:var(--border-subtle)] px-4 py-3 space-y-3">
                    {stagedOps.length === 0 ? (
                      <p className="text-sm text-[var(--text-muted)] text-center py-2">
                        No staged orders. Use the order form to stage trades.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {stagedOps.map((op, idx) => (
                          <div
                            key={`${op.symbol}-${op.action}-${idx}`}
                            className="flex items-center justify-between gap-3 px-3 py-2 rounded bg-slate-900/30 border border-[color:var(--border-subtle)]"
                          >
                            <div className="flex items-center gap-3">
                              <ActionBadge action={op.action} />
                              <span className="font-data font-bold text-blue-100 text-sm">{op.symbol}</span>
                              <span className="text-sm text-[var(--text-secondary)] tabular-nums">
                                {op.qty != null ? `${op.qty} units` : op.amount != null ? `$${op.amount}` : ''}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {stagedOps.length > 0 && (
                      <div className="space-y-2 pt-1">
                        <div>
                          <label htmlFor="commit-msg" className="field-label">Commit Message</label>
                          <input
                            id="commit-msg"
                            type="text"
                            className="field-input"
                            placeholder="e.g. Rebalance tech exposure"
                            value={commitMsg}
                            onChange={(e) => setCommitMsg(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && commitMsg.trim()) commitAndExecute()
                            }}
                          />
                        </div>
                        <button
                          onClick={commitAndExecute}
                          disabled={committing || !commitMsg.trim()}
                          className="btn-primary w-full py-2 text-sm disabled:opacity-40"
                        >
                          {committing ? 'Executing...' : 'Commit & Execute'}
                        </button>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.section>

          {/* ─── Section 4: Trade History ─── */}
          <motion.section
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="surface-panel rounded overflow-hidden"
          >
            <button
              onClick={() => setHistoryOpen((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
            >
              <h2 className="text-base font-semibold text-[var(--text-primary)]">Trade History</h2>
              <ChevronDown
                size={16}
                className="text-[var(--text-muted)] transition-transform duration-200"
                style={{ transform: historyOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
              />
            </button>

            <AnimatePresence initial={false}>
              {historyOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="border-t border-[color:var(--border-subtle)]">
                    {history.length === 0 ? (
                      <div className="p-4">
                        <EmptyState
                          icon={<Clock size={24} />}
                          title="No trade history yet"
                          description="Committed and executed trades will appear here."
                        />
                      </div>
                    ) : (
                      <div className="divide-y divide-[color:var(--border-subtle)]">
                        {history.map((commit) => (
                          <div key={commit.hash}>
                            <button
                              onClick={() =>
                                setExpandedCommit((prev) => (prev === commit.hash ? null : commit.hash))
                              }
                              className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <span className="flex items-center gap-1 text-xs font-data text-cyan-300/80">
                                  <Hash size={11} />
                                  {truncHash(commit.hash)}
                                </span>
                                <span className="text-sm text-[var(--text-primary)] truncate">
                                  {commit.message}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span className="text-xs text-[var(--text-muted)] tabular-nums whitespace-nowrap">
                                  {fmtDate(commit.timestamp)}
                                </span>
                                <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded text-xs font-semibold bg-slate-700/50 text-[var(--text-secondary)] border border-[color:var(--border-subtle)]">
                                  {commit.operations.length}
                                </span>
                                <ChevronDown
                                  size={13}
                                  className="text-[var(--text-muted)] transition-transform duration-200"
                                  style={{
                                    transform: expandedCommit === commit.hash ? 'rotate(180deg)' : 'rotate(0deg)',
                                  }}
                                />
                              </div>
                            </button>

                            <AnimatePresence initial={false}>
                              {expandedCommit === commit.hash && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.15 }}
                                  className="overflow-hidden"
                                >
                                  <div className="px-4 pb-3 space-y-1.5">
                                    {commit.operations.map((op, idx) => (
                                      <div
                                        key={`${commit.hash}-op-${idx}`}
                                        className="flex items-center gap-3 px-3 py-1.5 rounded bg-slate-900/30 border border-[color:var(--border-subtle)]"
                                      >
                                        <ActionBadge action={op.action} />
                                        <span className="font-data text-sm font-bold text-blue-100">
                                          {op.symbol}
                                        </span>
                                        <span className="text-sm text-[var(--text-secondary)] tabular-nums">
                                          {op.qty != null
                                            ? `${op.qty} units`
                                            : op.amount != null
                                              ? `$${op.amount}`
                                              : ''}
                                        </span>
                                        {op.price != null && (
                                          <span className="text-xs text-[var(--text-muted)] ml-auto tabular-nums">
                                            @ ${op.price}
                                          </span>
                                        )}
                                      </div>
                                    ))}
                                    {commit.results && commit.results.length > 0 && (
                                      <div className="mt-1.5 pt-1.5 border-t border-[color:var(--border-subtle)]">
                                        <p className="text-xs text-[var(--text-muted)] mb-1 uppercase tracking-wider font-semibold">
                                          Results
                                        </p>
                                        {commit.results.map((result, idx) => (
                                          <p
                                            key={`${commit.hash}-res-${idx}`}
                                            className="text-xs text-[var(--text-secondary)] font-data py-0.5"
                                          >
                                            {typeof result === 'string' ? result : JSON.stringify(result)}
                                          </p>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.section>
        </>
      )}

      {/* ─── OKX Crypto Tab ─── */}
      {activeTab === 'okx' && (
        <>
          {okxLoading ? (
            <TradingSkeleton />
          ) : (
            <>
              {/* ─── OKX Account Summary ─── */}
              <section className="grid grid-cols-2 gap-3">
                {[
                  {
                    label: 'Equity',
                    value: usd(okxAccount?.equity ?? 0),
                    icon: <Wallet size={16} />,
                    accent: 'text-cyan-200',
                  },
                  {
                    label: 'Unrealized PnL',
                    value: usd(okxAccount?.unrealizedPnL ?? 0),
                    icon: <TrendingUp size={16} />,
                    accent: pnlColor(okxAccount?.unrealizedPnL ?? 0),
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
                    <p className={`kpi-value ${card.accent}`}>{card.value}</p>
                  </motion.div>
                ))}
              </section>

              {/* ─── OKX Positions + Quick Stage Form ─── */}
              <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* OKX Positions Table */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.12 }}
                  className="surface-panel rounded overflow-hidden"
                >
                  <div className="px-4 py-3 border-b border-[color:var(--border-subtle)] flex items-center justify-between">
                    <h2 className="text-base font-semibold text-[var(--text-primary)]">OKX Positions</h2>
                    <button
                      onClick={() => {
                        setOkxLoading(true)
                        fetchOkxData().finally(() => setOkxLoading(false))
                      }}
                      className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                      title="Refresh OKX data"
                    >
                      <RefreshCw size={14} />
                    </button>
                  </div>
                  {okxPositions.length === 0 ? (
                    <div className="p-4">
                      <EmptyState
                        icon={<Bitcoin size={24} />}
                        title="No OKX positions"
                        description="Open positions on OKX will appear here."
                      />
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="table-terminal w-full min-w-[600px]">
                        <thead>
                          <tr className="bg-slate-900/35 text-[var(--text-muted)] text-xs border-b border-[color:var(--border-subtle)]">
                            <th className="px-3 py-2 text-left font-semibold uppercase tracking-[0.08em]">Instrument</th>
                            <th className="px-3 py-2 text-left font-semibold uppercase tracking-[0.08em]">Side</th>
                            <th className="px-3 py-2 text-right font-semibold uppercase tracking-[0.08em]">Qty</th>
                            <th className="px-3 py-2 text-right font-semibold uppercase tracking-[0.08em]">Entry</th>
                            <th className="px-3 py-2 text-right font-semibold uppercase tracking-[0.08em]">Mark</th>
                            <th className="px-3 py-2 text-right font-semibold uppercase tracking-[0.08em]">PnL</th>
                          </tr>
                        </thead>
                        <tbody>
                          {okxPositions.map((pos, idx) => (
                            <tr
                              key={`${pos.symbol}-${idx}`}
                              className={`border-b border-[color:var(--border-subtle)] hover:bg-white/5 transition-colors ${
                                idx % 2 === 1 ? 'bg-slate-900/15' : ''
                              }`}
                            >
                              <td className="px-3 py-2 font-data font-bold text-blue-100">{pos.symbol}</td>
                              <td className="px-3 py-2">
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold border ${
                                    pos.side.toUpperCase() === 'LONG' || pos.side.toUpperCase() === 'BUY'
                                      ? 'bg-green-500/15 text-[var(--up)] border-green-400/30'
                                      : 'bg-red-500/15 text-[var(--down)] border-red-400/30'
                                  }`}
                                >
                                  {pos.side.toUpperCase()}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right text-[var(--text-secondary)] font-data tabular-nums">
                                {pos.qty}
                              </td>
                              <td className="px-3 py-2 text-right text-[var(--text-secondary)] font-data tabular-nums">
                                {usd(pos.avgEntryPrice)}
                              </td>
                              <td className="px-3 py-2 text-right text-[var(--text-secondary)] font-data tabular-nums">
                                {usd(pos.currentPrice)}
                              </td>
                              <td className={`px-3 py-2 text-right font-data tabular-nums font-semibold ${pnlColor(pos.unrealizedPnL)}`}>
                                {usd(pos.unrealizedPnL)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </motion.div>

                {/* OKX Quick Stage Form */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.18 }}
                  className="surface-panel rounded p-3 md:p-4"
                >
                  <h2 className="text-base font-semibold text-[var(--text-primary)] mb-3">Quick Stage</h2>
                  <div className="space-y-3">
                    {/* Action Toggle */}
                    <div>
                      <label className="field-label">Action</label>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setOkxAction('BUY')}
                          className={`flex-1 py-2 rounded text-sm font-bold border transition-colors ${
                            okxAction === 'BUY'
                              ? 'bg-green-500/20 border-green-400/40 text-[var(--up)]'
                              : 'bg-transparent border-[color:var(--border-subtle)] text-[var(--text-muted)] hover:border-[color:var(--border-strong)]'
                          }`}
                        >
                          BUY
                        </button>
                        <button
                          onClick={() => setOkxAction('SELL')}
                          className={`flex-1 py-2 rounded text-sm font-bold border transition-colors ${
                            okxAction === 'SELL'
                              ? 'bg-red-500/20 border-red-400/40 text-[var(--down)]'
                              : 'bg-transparent border-[color:var(--border-subtle)] text-[var(--text-muted)] hover:border-[color:var(--border-strong)]'
                          }`}
                        >
                          SELL
                        </button>
                      </div>
                    </div>

                    {/* Instrument ID */}
                    <div>
                      <label htmlFor="okx-inst-id" className="field-label">Instrument ID</label>
                      <input
                        id="okx-inst-id"
                        type="text"
                        className="field-input uppercase"
                        placeholder="BTC-USDT"
                        value={okxInstId}
                        onChange={(e) => setOkxInstId(e.target.value.toUpperCase())}
                      />
                    </div>

                    {/* Quantity */}
                    <div>
                      <label htmlFor="okx-qty" className="field-label">Quantity</label>
                      <input
                        id="okx-qty"
                        type="number"
                        className="field-input"
                        placeholder="0.01"
                        min={0}
                        step="any"
                        value={okxQty}
                        onChange={(e) => setOkxQty(e.target.value)}
                      />
                    </div>

                    {/* Stage button */}
                    <button
                      onClick={stageOkxOrder}
                      disabled={okxStaging || !okxInstId.trim() || !okxQty.trim()}
                      className="btn-primary w-full py-2 text-sm disabled:opacity-40"
                    >
                      <Send size={14} />
                      {okxStaging ? 'Staging...' : 'Stage Order'}
                    </button>
                  </div>
                </motion.div>
              </section>

              {/* ─── OKX Staged Orders (shared) ─── */}
              <motion.section
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.24 }}
                className="surface-panel rounded overflow-hidden"
              >
                <button
                  onClick={() => setOkxStagedOpen((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <h2 className="text-base font-semibold text-[var(--text-primary)]">Staged Orders</h2>
                    {stagedOps.length > 0 && (
                      <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded text-xs font-bold bg-blue-500/20 text-blue-300 border border-blue-400/30">
                        {stagedOps.length}
                      </span>
                    )}
                  </div>
                  <ChevronDown
                    size={16}
                    className="text-[var(--text-muted)] transition-transform duration-200"
                    style={{ transform: okxStagedOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  />
                </button>

                <AnimatePresence initial={false}>
                  {okxStagedOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-[color:var(--border-subtle)] px-4 py-3 space-y-3">
                        {stagedOps.length === 0 ? (
                          <p className="text-sm text-[var(--text-muted)] text-center py-2">
                            No staged orders. Use the quick stage form above.
                          </p>
                        ) : (
                          <div className="space-y-1.5">
                            {stagedOps.map((op, idx) => (
                              <div
                                key={`okx-${op.symbol}-${op.action}-${idx}`}
                                className="flex items-center justify-between gap-3 px-3 py-2 rounded bg-slate-900/30 border border-[color:var(--border-subtle)]"
                              >
                                <div className="flex items-center gap-3">
                                  <ActionBadge action={op.action} />
                                  <span className="font-data font-bold text-blue-100 text-sm">{op.symbol}</span>
                                  <span className="text-sm text-[var(--text-secondary)] tabular-nums">
                                    {op.qty != null ? `${op.qty} units` : op.amount != null ? `$${op.amount}` : ''}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {stagedOps.length > 0 && (
                          <div className="space-y-2 pt-1">
                            <div>
                              <label htmlFor="okx-commit-msg" className="field-label">Commit Message</label>
                              <input
                                id="okx-commit-msg"
                                type="text"
                                className="field-input"
                                placeholder="e.g. Scale into BTC position"
                                value={commitMsg}
                                onChange={(e) => setCommitMsg(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && commitMsg.trim()) commitAndExecute()
                                }}
                              />
                            </div>
                            <button
                              onClick={commitAndExecute}
                              disabled={committing || !commitMsg.trim()}
                              className="btn-primary w-full py-2 text-sm disabled:opacity-40"
                            >
                              {committing ? 'Executing...' : 'Commit & Execute'}
                            </button>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.section>
            </>
          )}
        </>
      )}
    </div>
  )
}
