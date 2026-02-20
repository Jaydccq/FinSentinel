import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { portfolioApi, type PortfolioResponse } from '../api/portfolio'
import { marketApi, type QuoteData } from '../api/market'
import { TrendingUp, TrendingDown, Briefcase, DollarSign } from 'lucide-react'
import { Link } from 'react-router-dom'

const WATCH_TICKERS = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'META', 'TSLA', 'AMD', 'AMZN', 'AVGO', 'CRM', 'PLTR', 'SNOW']

const COLOR_META: Record<string, { border: string; tint: string }> = {
  'text-amber-400':  { border: 'border-l-amber-400',  tint: 'from-amber-500/5'  },
  'text-blue-400':   { border: 'border-l-blue-400',   tint: 'from-blue-500/5'   },
  'text-purple-400': { border: 'border-l-purple-400', tint: 'from-purple-500/5' },
}

function StatCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string; sub?: string; icon: React.ElementType; color: string
}) {
  const meta = COLOR_META[color] ?? { border: 'border-l-zinc-600', tint: 'from-zinc-600/5' }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className={`
        bg-zinc-900 rounded-xl p-6 border border-zinc-800/50
        border-l-[3px] ${meta.border}
        hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/20
        transition-all duration-200 cursor-default
      `}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-zinc-400 text-sm">{label}</span>
        <Icon size={18} className={color} />
      </div>
      <p className="text-2xl font-bold text-stone-50 font-data tabular-nums">{value}</p>
      {sub && <p className="text-xs text-zinc-500 mt-1">{sub}</p>}
    </motion.div>
  )
}

export default function DashboardPage() {
  const [portfolios, setPortfolios] = useState<PortfolioResponse[]>([])
  const [quotes, setQuotes] = useState<Record<string, QuoteData | null>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    portfolioApi.list().then(setPortfolios).finally(() => setLoading(false))
    marketApi.batchQuotes(WATCH_TICKERS)
      .then(data => {
        const parsed: Record<string, QuoteData | null> = {}
        for (const t of WATCH_TICKERS) {
          const q = data[t]
          parsed[t] = q && !('error' in q) ? q as QuoteData : null
        }
        setQuotes(parsed)
      })
      .catch(() => {
        const failed: Record<string, null> = {}
        WATCH_TICKERS.forEach(t => { failed[t] = null })
        setQuotes(failed)
      })
  }, [])

  const totalValue = portfolios.reduce((s, p) => s + Number(p.totalValue), 0)
  const totalHoldings = portfolios.reduce((s, p) => s + p.holdings.length, 0)

  return (
    <div className="p-10 space-y-10">
      {/* Page title */}
      <div>
        <h1 className="text-3xl font-display text-stone-50">
          Dashboard
        </h1>
        <p className="text-zinc-500 text-sm mt-2">Portfolio overview &amp; market watchlist</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <StatCard
          label="Total AUM"
          value={`$${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          icon={DollarSign}
          color="text-amber-400"
        />
        <StatCard label="Portfolios" value={String(portfolios.length)} icon={Briefcase} color="text-blue-400" />
        <StatCard label="Holdings" value={String(totalHoldings)} icon={TrendingUp} color="text-purple-400" />
      </div>

      {/* Portfolio cards */}
      <section>
        <div className="flex items-center gap-3 mb-5">
          <span className="w-[2px] h-5 bg-amber-500 rounded-full inline-block" />
          <h2 className="text-lg font-semibold text-zinc-200">Your Portfolios</h2>
        </div>

        {loading ? (
          <p className="text-zinc-500">Loading...</p>
        ) : portfolios.length === 0 ? (
          <div className="bg-zinc-900 border border-dashed border-zinc-700/50 rounded-xl p-8 text-center">
            <p className="text-zinc-400">No portfolios yet.</p>
            <Link to="/portfolio" className="text-amber-400/80 text-sm hover:underline mt-2 inline-block">
              Create your first portfolio →
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {portfolios.map((p, i) => (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="
                  bg-zinc-900 rounded-xl p-6 border border-zinc-800/50
                  hover:border-amber-500/30 hover:-translate-y-0.5
                  hover:shadow-lg hover:shadow-black/20
                  transition-all duration-200 cursor-default
                "
              >
                <p className="font-semibold text-stone-50 truncate">{p.name}</p>
                <p className="text-zinc-500 text-xs truncate mt-0.5">{p.description || 'No description'}</p>
                <p className="text-2xl font-bold text-emerald-400 mt-4 font-data tabular-nums">
                  ${Number(p.totalValue).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </p>
                <p className="text-zinc-500 text-xs mt-1">{p.holdings.length} holdings</p>
              </motion.div>
            ))}
          </div>
        )}
      </section>

      {/* Market watchlist */}
      <section>
        <div className="flex items-center gap-3 mb-5">
          <span className="w-[2px] h-5 bg-amber-500 rounded-full inline-block" />
          <h2 className="text-lg font-semibold text-zinc-200">Market Watchlist</h2>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {WATCH_TICKERS.map(ticker => {
            const q = quotes[ticker]
            const isLoading = !(ticker in quotes)
            const isFailed = ticker in quotes && q === null
            const change = q && q.open !== 0 ? ((q.close - q.open) / q.open) * 100 : null
            const isUp = change !== null && change >= 0

            return (
              <Link
                to={`/stock/${ticker}`}
                key={ticker}
                className="bg-zinc-900 rounded-xl p-5 border border-zinc-800/50 hover:-translate-y-0.5 hover:shadow-md hover:border-amber-500/30 transition-all duration-200"
              >
                <div className="flex items-center gap-1.5">
                  {q && change !== null ? (
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isUp ? 'bg-emerald-400' : 'bg-red-400'}`} />
                  ) : isFailed ? (
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-yellow-500" />
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-zinc-600" />
                  )}
                  <p className="font-data font-bold text-stone-50 tracking-wider text-sm">{ticker}</p>
                </div>

                {q && change !== null ? (
                  <>
                    <p className="text-lg font-bold mt-2 text-stone-50 font-data tabular-nums">${q.close.toFixed(2)}</p>
                    <span
                      className={`
                        inline-flex items-center gap-1 mt-1.5 px-2 py-0.5
                        rounded-full text-xs font-medium
                        ${isUp
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : 'bg-red-500/15 text-red-400'
                        }
                      `}
                    >
                      {isUp ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                      {isUp ? '+' : ''}{change.toFixed(2)}%
                    </span>
                  </>
                ) : isFailed ? (
                  <p className="text-yellow-600 text-sm mt-1">Market data unavailable</p>
                ) : isLoading ? (
                  <p className="text-zinc-600 text-sm mt-1">Loading…</p>
                ) : null}
              </Link>
            )
          })}
        </div>
      </section>
    </div>
  )
}
