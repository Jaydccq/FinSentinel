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
} from 'lucide-react'
import { toast } from 'sonner'
import {
  tradingApi,
  type WalletStatus,
  type StagedOrders,
  type TradeCommit,
  type TradeOperation,
} from '../api/trading'
import EmptyState from '../components/EmptyState'

/* ─── Helpers ─── */

function usd(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function pct(n: number) {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function pnlColor(n: number) {
  if (n > 0) return 'text-emerald-300'
  if (n < 0) return 'text-red-400'
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
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="surface-panel rounded-2xl p-5 space-y-3">
            <div className={`${bar} h-3 w-20`} />
            <div className={`${bar} h-7 w-28`} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="surface-panel rounded-2xl p-5 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`${bar} h-10 w-full`} />
          ))}
        </div>
        <div className="surface-panel rounded-2xl p-5 space-y-3">
          <div className={`${bar} h-10 w-full`} />
          <div className={`${bar} h-10 w-full`} />
          <div className={`${bar} h-10 w-full`} />
          <div className={`${bar} h-11 w-full rounded-xl`} />
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
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${
        isBuy
          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30'
          : 'bg-red-500/15 text-red-300 border-red-400/30'
      }`}
    >
      {isBuy ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
      {action.toUpperCase()}
    </span>
  )
}

/* ─── Main Page ─── */

export default function TradingPage() {
  const [wallet, setWallet] = useState<WalletStatus | null>(null)
  const [staged, setStaged] = useState<StagedOrders | null>(null)
  const [history, setHistory] = useState<TradeCommit[]>([])
  const [loading, setLoading] = useState(true)

  // Order form
  const [action, setAction] = useState<'BUY' | 'SELL'>('BUY')
  const [ticker, setTicker] = useState('')
  const [shares, setShares] = useState('')
  const [staging, setStaging] = useState(false)

  // Commit form
  const [commitMsg, setCommitMsg] = useState('')
  const [committing, setCommitting] = useState(false)

  // Collapsible sections
  const [stagedOpen, setStagedOpen] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(true)
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null)

  const walletTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  /* ─── Fetchers ─── */

  const fetchWallet = useCallback(async () => {
    try {
      const data = await tradingApi.wallet()
      setWallet(data)
    } catch {
      // silent on auto-refresh
    }
  }, [])

  const fetchStaged = useCallback(async () => {
    try {
      const data = await tradingApi.staged()
      setStaged(data)
    } catch {
      setStaged({ operations: [], count: 0 })
    }
  }, [])

  const fetchHistory = useCallback(async () => {
    try {
      const data = await tradingApi.history(10)
      setHistory(data)
    } catch {
      setHistory([])
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

  /* ─── Actions ─── */

  const stageOrder = async () => {
    if (!ticker.trim() || !shares.trim()) {
      toast.error('Ticker and shares are required.')
      return
    }
    setStaging(true)
    try {
      await tradingApi.stage({ action, ticker: ticker.toUpperCase(), shares: Number(shares) })
      toast.success(`Staged ${action} ${shares} ${ticker.toUpperCase()}`)
      setTicker('')
      setShares('')
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
      await tradingApi.commit(commitMsg)
      const result = await tradingApi.execute()
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

  /* ─── Render ─── */

  if (loading) {
    return (
      <div className="px-4 py-6 md:px-8 md:py-8 space-y-6">
        <section className="glass-panel rounded-3xl p-6 md:p-8">
          <h1 className="page-title">Trading Desk</h1>
          <p className="page-subtitle">Stage, commit, and execute paper or live trades.</p>
        </section>
        <TradingSkeleton />
      </div>
    )
  }

  const positions = wallet?.positions ?? []
  const stagedOps: TradeOperation[] = staged?.operations ?? []
  const isPaper = wallet?.tradingMode?.toUpperCase() !== 'LIVE'

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 space-y-6">
      {/* ─── Header ─── */}
      <section className="glass-panel rounded-3xl p-6 md:p-8 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Trading Desk</h1>
          <p className="page-subtitle">Stage, commit, and execute paper or live trades.</p>
        </div>
      </section>

      {/* ─── Section 1: Wallet Overview ─── */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: 'Cash Balance',
            value: usd(wallet?.cashBalance ?? 0),
            icon: <DollarSign size={18} />,
            accent: 'text-amber-200',
          },
          {
            label: 'Total Value',
            value: usd(wallet?.totalValue ?? 0),
            icon: <Wallet size={18} />,
            accent: 'text-cyan-200',
          },
          {
            label: 'Total Return',
            value: pct(wallet?.returnPercent ?? 0),
            icon: <TrendingUp size={18} />,
            accent: pnlColor(wallet?.returnPercent ?? 0),
          },
          {
            label: 'Trading Mode',
            value: isPaper ? 'PAPER' : 'LIVE',
            icon: <Activity size={18} />,
            accent: isPaper ? 'text-cyan-300' : 'text-red-400',
            badge: true,
          },
        ].map((card, i) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className="surface-panel rounded-2xl p-4 md:p-5"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                {card.label}
              </span>
              <span className="text-[var(--text-muted)]">{card.icon}</span>
            </div>
            {card.badge ? (
              <span
                className={`inline-block px-3 py-1 rounded-full text-sm font-bold border ${
                  isPaper
                    ? 'bg-cyan-500/15 border-cyan-400/30 text-cyan-300'
                    : 'bg-red-500/15 border-red-400/30 text-red-400'
                }`}
              >
                {card.value}
              </span>
            ) : (
              <p className={`kpi-value text-lg md:text-xl ${card.accent}`}>{card.value}</p>
            )}
          </motion.div>
        ))}
      </section>

      {/* ─── Section 2: Positions + Order Form ─── */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Positions Table */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12 }}
          className="surface-panel rounded-2xl overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-[color:var(--border-subtle)]">
            <h2 className="text-base font-semibold text-[var(--text-primary)]">Open Positions</h2>
          </div>
          {positions.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={<Package size={24} />}
                title="No open positions"
                description="Execute a buy order to open a position."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[540px]">
                <thead>
                  <tr className="bg-slate-900/35 text-[var(--text-muted)] text-xs border-b border-[color:var(--border-subtle)]">
                    <th className="px-4 py-3 text-left font-semibold uppercase tracking-[0.08em]">Ticker</th>
                    <th className="px-4 py-3 text-right font-semibold uppercase tracking-[0.08em]">Shares</th>
                    <th className="px-4 py-3 text-right font-semibold uppercase tracking-[0.08em]">Avg Cost</th>
                    <th className="px-4 py-3 text-right font-semibold uppercase tracking-[0.08em]">Current</th>
                    <th className="px-4 py-3 text-right font-semibold uppercase tracking-[0.08em]">P&L</th>
                    <th className="px-4 py-3 text-right font-semibold uppercase tracking-[0.08em]">P&L %</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((pos, idx) => (
                    <tr
                      key={pos.ticker}
                      className={`border-b border-[color:var(--border-subtle)] hover:bg-white/5 transition-colors ${
                        idx % 2 === 1 ? 'bg-slate-900/15' : ''
                      }`}
                    >
                      <td className="px-4 py-3 font-data font-bold text-amber-100">{pos.ticker}</td>
                      <td className="px-4 py-3 text-right text-[var(--text-secondary)] font-data tabular-nums">
                        {pos.shares}
                      </td>
                      <td className="px-4 py-3 text-right text-[var(--text-secondary)] font-data tabular-nums">
                        {usd(pos.avgCost)}
                      </td>
                      <td className="px-4 py-3 text-right text-[var(--text-secondary)] font-data tabular-nums">
                        {usd(pos.currentPrice)}
                      </td>
                      <td className={`px-4 py-3 text-right font-data tabular-nums font-semibold ${pnlColor(pos.unrealizedPnl)}`}>
                        {usd(pos.unrealizedPnl)}
                      </td>
                      <td className={`px-4 py-3 text-right font-data tabular-nums font-semibold ${pnlColor(pos.pnlPercent)}`}>
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
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18 }}
          className="surface-panel rounded-2xl p-5 md:p-6"
        >
          <h2 className="text-base font-semibold text-[var(--text-primary)] mb-4">New Order</h2>
          <div className="space-y-4">
            {/* Action Toggle */}
            <div>
              <label className="field-label">Action</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setAction('BUY')}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition-colors ${
                    action === 'BUY'
                      ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-300'
                      : 'bg-transparent border-[color:var(--border-subtle)] text-[var(--text-muted)] hover:border-[color:var(--border-strong)]'
                  }`}
                >
                  BUY
                </button>
                <button
                  onClick={() => setAction('SELL')}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition-colors ${
                    action === 'SELL'
                      ? 'bg-red-500/20 border-red-400/40 text-red-300'
                      : 'bg-transparent border-[color:var(--border-subtle)] text-[var(--text-muted)] hover:border-[color:var(--border-strong)]'
                  }`}
                >
                  SELL
                </button>
              </div>
            </div>

            {/* Ticker */}
            <div>
              <label htmlFor="order-ticker" className="field-label">Ticker</label>
              <input
                id="order-ticker"
                type="text"
                className="field-input uppercase"
                placeholder="AAPL"
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
              />
            </div>

            {/* Shares */}
            <div>
              <label htmlFor="order-shares" className="field-label">Shares</label>
              <input
                id="order-shares"
                type="number"
                className="field-input"
                placeholder="100"
                min={1}
                value={shares}
                onChange={(e) => setShares(e.target.value)}
              />
            </div>

            {/* Stage button */}
            <button
              onClick={stageOrder}
              disabled={staging || !ticker.trim() || !shares.trim()}
              className="btn-primary w-full py-2.5 text-sm disabled:opacity-40"
            >
              <Send size={14} />
              {staging ? 'Staging...' : 'Stage Order'}
            </button>
          </div>
        </motion.div>
      </section>

      {/* ─── Section 3: Staged Orders ─── */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.24 }}
        className="surface-panel rounded-2xl overflow-hidden"
      >
        <button
          onClick={() => setStagedOpen((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-[var(--text-primary)]">Staged Orders</h2>
            {stagedOps.length > 0 && (
              <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-400/30">
                {stagedOps.length}
              </span>
            )}
          </div>
          <ChevronDown
            size={17}
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
              <div className="border-t border-[color:var(--border-subtle)] px-5 py-4 space-y-4">
                {stagedOps.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)] text-center py-3">
                    No staged orders. Use the order form to stage trades.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {stagedOps.map((op, idx) => (
                      <div
                        key={`${op.ticker}-${op.action}-${idx}`}
                        className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-slate-900/30 border border-[color:var(--border-subtle)]"
                      >
                        <div className="flex items-center gap-3">
                          <ActionBadge action={op.action} />
                          <span className="font-data font-bold text-amber-100 text-sm">{op.ticker}</span>
                          <span className="text-sm text-[var(--text-secondary)] tabular-nums">
                            {op.shares != null ? `${op.shares} shares` : op.amount != null ? usd(op.amount) : ''}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {stagedOps.length > 0 && (
                  <div className="space-y-3 pt-2">
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
                      className="btn-primary w-full py-2.5 text-sm disabled:opacity-40"
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
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="surface-panel rounded-2xl overflow-hidden"
      >
        <button
          onClick={() => setHistoryOpen((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/5 transition-colors"
        >
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Trade History</h2>
          <ChevronDown
            size={17}
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
                  <div className="p-5">
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
                          className="w-full flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-white/5 transition-colors text-left"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="flex items-center gap-1.5 text-xs font-data text-cyan-300/80">
                              <Hash size={12} />
                              {truncHash(commit.hash)}
                            </span>
                            <span className="text-sm text-[var(--text-primary)] truncate">
                              {commit.message}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <span className="text-xs text-[var(--text-muted)] tabular-nums whitespace-nowrap">
                              {fmtDate(commit.timestamp)}
                            </span>
                            <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full text-xs font-semibold bg-slate-700/50 text-[var(--text-secondary)] border border-[color:var(--border-subtle)]">
                              {commit.operations.length}
                            </span>
                            <ChevronDown
                              size={14}
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
                              <div className="px-5 pb-4 space-y-2">
                                {commit.operations.map((op, idx) => (
                                  <div
                                    key={`${commit.hash}-op-${idx}`}
                                    className="flex items-center gap-3 px-4 py-2 rounded-lg bg-slate-900/30 border border-[color:var(--border-subtle)]"
                                  >
                                    <ActionBadge action={op.action} />
                                    <span className="font-data text-sm font-bold text-amber-100">
                                      {op.ticker}
                                    </span>
                                    <span className="text-sm text-[var(--text-secondary)] tabular-nums">
                                      {op.shares != null
                                        ? `${op.shares} shares`
                                        : op.amount != null
                                          ? usd(op.amount)
                                          : ''}
                                    </span>
                                    {op.price != null && (
                                      <span className="text-xs text-[var(--text-muted)] ml-auto tabular-nums">
                                        @ {usd(op.price)}
                                      </span>
                                    )}
                                  </div>
                                ))}
                                {commit.results && commit.results.length > 0 && (
                                  <div className="mt-2 pt-2 border-t border-[color:var(--border-subtle)]">
                                    <p className="text-xs text-[var(--text-muted)] mb-1.5 uppercase tracking-wider font-semibold">
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
    </div>
  )
}
