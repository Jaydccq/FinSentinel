'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import {
  TrendingUp,
  Briefcase,
  DollarSign,
  Layers3,
  ArrowUpRight,
  Pencil,
  X,
  Check,
} from 'lucide-react'
import { toast } from 'sonner'
import { portfolioApi, type PortfolioResponse } from '../api/portfolio'
import { marketApi, type QuoteData } from '../api/market'
import { StatCardsSkeleton, PortfolioListSkeleton, WatchlistSkeleton } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import TickerSearchInput from '../components/TickerSearchInput'

const DEFAULT_TICKERS = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'META', 'TSLA', 'BTC-USD', 'ETH-USD', 'AMD', 'AMZN', 'AVGO', 'SOL-USD']
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

const COLOR_META: Record<string, { icon: string; border: string; text: string }> = {
  blue: {
    icon: 'text-blue-200 bg-blue-400/15',
    border: 'border-status-info',
    text: 'text-blue-100',
  },
  cyan: {
    icon: 'text-cyan-200 bg-cyan-400/15',
    border: 'border-status-info',
    text: 'text-cyan-100',
  },
  indigo: {
    icon: 'text-blue-200 bg-blue-400/15',
    border: 'border-status-info',
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
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={`surface-panel surface-panel-hover rounded p-3 md:p-4 border-l-2 ${meta.border}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.11em] text-[var(--text-muted)]">{label}</p>
          <p className={`kpi-value mt-2 ${meta.text}`}>{value}</p>
          {sub && <p className="text-xs text-[var(--text-secondary)] mt-1.5">{sub}</p>}
        </div>

        <div className={`h-8 w-8 rounded flex items-center justify-center ${meta.icon}`}>
          <Icon size={16} aria-hidden="true" />
        </div>
      </div>
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

  const removeTicker = (ticker: string) => {
    const updated = watchlist.filter(t => t !== ticker)
    setWatchlist(updated)
    saveWatchlist(updated)
  }

  const doneEditing = () => {
    setEditing(false)
  }

  const totalValue = portfolios.reduce((sum, p) => sum + Number(p.totalValue), 0)
  const totalHoldings = portfolios.reduce((sum, p) => sum + p.holdings.length, 0)

  return (
    <div className="px-4 py-4 md:px-8 md:py-6 space-y-4">
      <section className="glass-panel rounded p-3 md:p-4">
        <p className="text-xs uppercase tracking-[0.13em] text-blue-200/80">Portfolio Intelligence</p>
        <h1 className="page-title mt-2">Dashboard</h1>
        <p className="page-subtitle max-w-2xl">Track value concentration, monitor top holdings, and react to market movement in one view.</p>
      </section>

      {loading ? (
        <StatCardsSkeleton />
      ) : (
        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4">
          <StatCard
            label="Total AUM"
            value={`$${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            icon={DollarSign}
            color="blue"
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
            color="indigo"
          />
        </section>
      )}

      <section className="surface-panel rounded p-3 md:p-4">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-xl font-semibold text-[var(--text-primary)]">Your Portfolios</h2>
            <p className="text-sm text-[var(--text-secondary)] mt-0.5">Current market value and holding density</p>
          </div>
          <Link href="/portfolio" className="btn-ghost px-3 py-2 text-xs">Open Manager</Link>
        </div>

        {loading ? (
          <PortfolioListSkeleton />
        ) : portfolios.length === 0 ? (
          <EmptyState
            icon={<Briefcase size={28} />}
            title="No portfolios yet."
            action={
              <Link href="/portfolio" className="inline-flex text-sm font-semibold text-blue-200 hover:text-blue-100 transition-colors">
                Create your first portfolio
              </Link>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {portfolios.map((portfolio, i) => (
              <motion.div
                key={portfolio.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.05 }}
                className="surface-panel surface-panel-hover rounded p-3"
              >
                <p className="text-base font-semibold text-[var(--text-primary)] truncate">{portfolio.name}</p>
                <p className="text-xs text-[var(--text-muted)] mt-1 truncate">{portfolio.description || 'No description'}</p>
                <p className="kpi-value mt-3 text-[var(--up)]">
                  ${Number(portfolio.totalValue).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </p>
                <div className="mt-2 flex items-center justify-between text-xs text-[var(--text-secondary)]">
                  <span>{portfolio.holdings.length} holdings</span>
                  <Link href="/portfolio" className="inline-flex items-center gap-1 text-blue-200 hover:text-blue-100">
                    Details <ArrowUpRight size={13} />
                  </Link>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </section>

      <section className="surface-panel rounded p-3 md:p-4">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-xl font-semibold text-[var(--text-primary)]">Market Watchlist</h2>
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
          <div className="mb-4 max-w-sm">
            <TickerSearchInput
              onSelect={({ symbol }) => {
                if (!watchlist.includes(symbol)) {
                  const updated = [...watchlist, symbol]
                  setWatchlist(updated)
                  saveWatchlist(updated)
                  marketApi.batchQuotes([symbol])
                    .then(data => {
                      const quote = data[symbol]
                      setQuotes(prev => ({
                        ...prev,
                        [symbol]: quote && !('error' in quote) ? (quote as QuoteData) : null,
                      }))
                    })
                    .catch(() => {
                      setQuotes(prev => ({ ...prev, [symbol]: null }))
                    })
                }
              }}
              excludeSymbols={watchlist}
              placeholder="Search stocks or crypto to add..."
            />
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
          <div className="grid grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-2">
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
                      className="absolute -top-1.5 -right-1.5 z-10 h-5 w-5 rounded-full bg-red-500/90 text-white flex items-center justify-center shadow hover:bg-red-500 transition-colors"
                      aria-label={`Remove ${ticker}`}
                    >
                      <X size={10} />
                    </button>
                  )}
                  <Link
                    href={editing ? '#' : `/stock/${ticker}`}
                    onClick={e => editing && e.preventDefault()}
                    className={`surface-panel rounded p-2.5 block ${editing ? 'ring-1 ring-blue-400/25' : 'surface-panel-hover'}`}
                  >
                    <div className="flex items-center justify-between gap-1 flex-wrap">
                      <div className="flex items-center gap-1">
                        <p className="font-data text-xs font-bold tracking-wide text-[var(--text-primary)]">{ticker}</p>
                        {ticker.includes('-') && (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-orange-500/15 text-orange-300 font-medium">
                            C
                          </span>
                        )}
                      </div>
                      {change !== null && !editing && (
                        <span className={`status-chip border-0 text-[10px] px-1 py-0 ${isUp ? 'bg-green-500/20 text-[var(--up)]' : 'bg-red-500/20 text-[var(--down)]'}`}>
                          {isUp ? '+' : ''}{change.toFixed(2)}%
                        </span>
                      )}
                    </div>

                    {!editing && (
                      quote && change !== null ? (
                        <>
                          <p className="kpi-value mt-2 text-sm">${quote.close.toFixed(2)}</p>
                          <p className="text-[10px] text-[var(--text-muted)] mt-0.5">o ${quote.open.toFixed(2)}</p>
                        </>
                      ) : isFailed ? (
                        <p className="text-[11px] text-yellow-200 mt-2">N/A</p>
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
