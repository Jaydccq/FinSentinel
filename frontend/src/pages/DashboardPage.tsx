import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import {
  TrendingUp,
  TrendingDown,
  Briefcase,
  DollarSign,
  Layers3,
  ArrowUpRight,
  Pencil,
  Plus,
  X,
  Check,
} from 'lucide-react'
import { toast } from 'sonner'
import { portfolioApi, type PortfolioResponse } from '../api/portfolio'
import { marketApi, type QuoteData } from '../api/market'
import { StatCardsSkeleton, PortfolioListSkeleton, WatchlistSkeleton } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'

const DEFAULT_TICKERS = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'META', 'TSLA', 'AMD', 'AMZN', 'AVGO', 'CRM', 'PLTR', 'SNOW']
const LS_KEY = 'finsentinel_watchlist'

function loadWatchlist(): string[] {
  try {
    const stored = localStorage.getItem(LS_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch { /* ignore */ }
  return DEFAULT_TICKERS
}

function saveWatchlist(tickers: string[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(tickers))
}

const COLOR_META: Record<string, { icon: string; bar: string; text: string }> = {
  amber: {
    icon: 'text-amber-200 bg-amber-400/15',
    bar: 'from-amber-300/80 to-amber-500/80',
    text: 'text-amber-100',
  },
  cyan: {
    icon: 'text-cyan-200 bg-cyan-400/15',
    bar: 'from-cyan-300/80 to-cyan-500/80',
    text: 'text-cyan-100',
  },
  blue: {
    icon: 'text-blue-200 bg-blue-400/15',
    bar: 'from-blue-300/80 to-blue-500/80',
    text: 'text-blue-100',
  },
}

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  color,
}: {
  label: string
  value: string
  sub?: string
  icon: React.ElementType
  color: keyof typeof COLOR_META
}) {
  const meta = COLOR_META[color]

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="surface-panel surface-panel-hover rounded-2xl p-5 md:p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.11em] text-[var(--text-muted)]">{label}</p>
          <p className={`kpi-value mt-2 ${meta.text}`}>{value}</p>
          {sub && <p className="text-xs text-[var(--text-secondary)] mt-1.5">{sub}</p>}
        </div>

        <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${meta.icon}`}>
          <Icon size={18} aria-hidden="true" />
        </div>
      </div>

      <div className={`mt-5 h-1.5 rounded-full bg-gradient-to-r ${meta.bar}`} />
    </motion.div>
  )
}

export default function DashboardPage() {
  const [portfolios, setPortfolios] = useState<PortfolioResponse[]>([])
  const [watchlist, setWatchlist] = useState<string[]>(loadWatchlist)
  const [quotes, setQuotes] = useState<Record<string, QuoteData | null>>({})
  const [loading, setLoading] = useState(true)
  const [quotesLoading, setQuotesLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [newTicker, setNewTicker] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchQuotes = useCallback((tickers: string[]) => {
    if (tickers.length === 0) {
      setQuotes({})
      setQuotesLoading(false)
      return
    }
    marketApi.batchQuotes(tickers)
      .then(data => {
        const parsed: Record<string, QuoteData | null> = {}
        for (const ticker of tickers) {
          const quote = data[ticker]
          parsed[ticker] = quote && !('error' in quote) ? (quote as QuoteData) : null
        }
        setQuotes(parsed)
      })
      .catch(() => {
        toast.warning('Market data temporarily unavailable.')
        const failed: Record<string, null> = {}
        tickers.forEach(ticker => { failed[ticker] = null })
        setQuotes(failed)
      })
      .finally(() => setQuotesLoading(false))
  }, [])

  useEffect(() => {
    portfolioApi.list()
      .then(setPortfolios)
      .catch(() => toast.error('Failed to load portfolios.'))
      .finally(() => setLoading(false))

    // Initial quote fetch — uses marketApi directly to avoid lint false-positive
    // on calling fetchQuotes (which internally calls setState) within effect body
    marketApi.batchQuotes(watchlist)
      .then(data => {
        const parsed: Record<string, QuoteData | null> = {}
        for (const ticker of watchlist) {
          const quote = data[ticker]
          parsed[ticker] = quote && !('error' in quote) ? (quote as QuoteData) : null
        }
        setQuotes(parsed)
      })
      .catch(() => {
        toast.warning('Market data temporarily unavailable.')
        const failed: Record<string, null> = {}
        watchlist.forEach(ticker => { failed[ticker] = null })
        setQuotes(failed)
      })
      .finally(() => setQuotesLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 60-second auto-refresh polling
  useEffect(() => {
    pollRef.current = setInterval(() => {
      fetchQuotes(watchlist)
    }, 60_000)

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [watchlist, fetchQuotes])

  const addTicker = () => {
    const ticker = newTicker.trim().toUpperCase()
    if (!ticker || ticker.length > 5 || watchlist.includes(ticker)) return
    const updated = [...watchlist, ticker]
    setWatchlist(updated)
    saveWatchlist(updated)
    setNewTicker('')
    // Fetch the new ticker's quote immediately
    marketApi.batchQuotes([ticker])
      .then(data => {
        const quote = data[ticker]
        setQuotes(prev => ({
          ...prev,
          [ticker]: quote && !('error' in quote) ? (quote as QuoteData) : null,
        }))
      })
      .catch(() => {
        setQuotes(prev => ({ ...prev, [ticker]: null }))
      })
  }

  const removeTicker = (ticker: string) => {
    const updated = watchlist.filter(t => t !== ticker)
    setWatchlist(updated)
    saveWatchlist(updated)
  }

  const doneEditing = () => {
    setEditing(false)
    setNewTicker('')
  }

  const totalValue = portfolios.reduce((sum, p) => sum + Number(p.totalValue), 0)
  const totalHoldings = portfolios.reduce((sum, p) => sum + p.holdings.length, 0)

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 space-y-7">
      <section className="glass-panel rounded-3xl p-6 md:p-8">
        <p className="text-xs uppercase tracking-[0.13em] text-amber-200/80">Portfolio Intelligence</p>
        <h1 className="page-title mt-3">Dashboard</h1>
        <p className="page-subtitle max-w-2xl">Track value concentration, monitor top holdings, and react to market movement in one view.</p>
      </section>

      {loading ? (
        <StatCardsSkeleton />
      ) : (
        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-5">
          <StatCard
            label="Total AUM"
            value={`$${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            icon={DollarSign}
            color="amber"
          />
          <StatCard
            label="Portfolio Count"
            value={String(portfolios.length)}
            icon={Briefcase}
            color="cyan"
          />
          <StatCard
            label="Holding Positions"
            value={String(totalHoldings)}
            icon={Layers3}
            color="blue"
          />
        </section>
      )}

      <section className="surface-panel rounded-3xl p-5 md:p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-xl font-display text-[var(--text-primary)]">Your Portfolios</h2>
            <p className="text-sm text-[var(--text-secondary)] mt-0.5">Current market value and holding density</p>
          </div>
          <Link to="/portfolio" className="btn-ghost px-3 py-2 text-xs">Open Manager</Link>
        </div>

        {loading ? (
          <PortfolioListSkeleton />
        ) : portfolios.length === 0 ? (
          <EmptyState
            icon={<Briefcase size={28} />}
            title="No portfolios yet."
            action={
              <Link to="/portfolio" className="inline-flex text-sm font-semibold text-amber-200 hover:text-amber-100 transition-colors">
                Create your first portfolio
              </Link>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {portfolios.map((portfolio, i) => (
              <motion.div
                key={portfolio.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="surface-panel surface-panel-hover rounded-2xl p-5"
              >
                <p className="text-base font-semibold text-[var(--text-primary)] truncate">{portfolio.name}</p>
                <p className="text-xs text-[var(--text-muted)] mt-1 truncate">{portfolio.description || 'No description'}</p>
                <p className="kpi-value mt-4 text-emerald-200">
                  ${Number(portfolio.totalValue).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </p>
                <div className="mt-3 flex items-center justify-between text-xs text-[var(--text-secondary)]">
                  <span>{portfolio.holdings.length} holdings</span>
                  <Link to="/portfolio" className="inline-flex items-center gap-1 text-amber-200 hover:text-amber-100">
                    Details <ArrowUpRight size={13} />
                  </Link>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </section>

      <section className="surface-panel rounded-3xl p-5 md:p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-xl font-display text-[var(--text-primary)]">Market Watchlist</h2>
            <p className="text-sm text-[var(--text-secondary)] mt-0.5">
              {editing ? 'Add or remove tickers from your watchlist' : 'Selected tickers with intraday direction'}
            </p>
          </div>
          {editing ? (
            <button onClick={doneEditing} className="btn-primary px-3 py-2 text-xs">
              <Check size={13} /> Done
            </button>
          ) : (
            <button onClick={() => setEditing(true)} className="btn-ghost px-3 py-2 text-xs">
              <Pencil size={13} /> Edit Watchlist
            </button>
          )}
        </div>

        {editing && (
          <div className="flex items-center gap-2 mb-4">
            <input
              className="field-input py-1.5 max-w-[160px] text-xs font-data uppercase"
              placeholder="e.g. AAPL"
              value={newTicker}
              onChange={e => setNewTicker(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && addTicker()}
              maxLength={5}
            />
            <button
              onClick={addTicker}
              disabled={!newTicker.trim() || watchlist.includes(newTicker.trim().toUpperCase())}
              className="btn-primary px-3 py-1.5 text-xs disabled:opacity-40"
            >
              <Plus size={13} /> Add
            </button>
          </div>
        )}

        {quotesLoading ? (
          <WatchlistSkeleton />
        ) : watchlist.length === 0 ? (
          <EmptyState
            icon={<TrendingUp size={28} />}
            title="Watchlist is empty."
            description="Click 'Edit Watchlist' to add tickers."
          />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            {watchlist.map(ticker => {
              const quote = quotes[ticker]
              const isFailed = ticker in quotes && quote === null
              const change = quote && quote.open !== 0 ? ((quote.close - quote.open) / quote.open) * 100 : null
              const isUp = change !== null && change >= 0

              return (
                <div key={ticker} className="relative">
                  {editing && (
                    <button
                      onClick={() => removeTicker(ticker)}
                      className="absolute -top-1.5 -right-1.5 z-10 h-6 w-6 rounded-full bg-red-500/90 text-white flex items-center justify-center shadow-lg hover:bg-red-500 transition-colors"
                      aria-label={`Remove ${ticker}`}
                    >
                      <X size={12} />
                    </button>
                  )}
                  <Link
                    to={editing ? '#' : `/stock/${ticker}`}
                    onClick={e => editing && e.preventDefault()}
                    className={`surface-panel rounded-2xl p-4 block ${editing ? 'ring-1 ring-amber-400/25' : 'surface-panel-hover'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-data text-sm font-bold tracking-wide text-[var(--text-primary)]">{ticker}</p>
                      {change !== null && !editing && (
                        <span className={`status-chip border-0 ${isUp ? 'bg-emerald-500/20 text-emerald-100' : 'bg-red-500/20 text-red-100'}`}>
                          {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                          {isUp ? '+' : ''}{change.toFixed(2)}%
                        </span>
                      )}
                    </div>

                    {!editing && (
                      quote && change !== null ? (
                        <>
                          <p className="kpi-value mt-3 text-lg md:text-xl">${quote.close.toFixed(2)}</p>
                          <p className="text-[11px] text-[var(--text-muted)] mt-1">open ${quote.open.toFixed(2)}</p>
                        </>
                      ) : isFailed ? (
                        <p className="text-sm text-yellow-200 mt-3">Market data unavailable</p>
                      ) : null
                    )}
                  </Link>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
