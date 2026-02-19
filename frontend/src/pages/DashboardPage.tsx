import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { portfolioApi, type PortfolioResponse } from '../api/portfolio'
import { marketApi, type QuoteData } from '../api/market'
import { TrendingUp, TrendingDown, Briefcase, DollarSign } from 'lucide-react'
import { Link } from 'react-router-dom'

const WATCH_TICKERS = ['AAPL', 'MSFT', 'NVDA', 'TSLA']

// Map icon color tokens to Tailwind background tint + border classes
const COLOR_META: Record<string, { border: string; tint: string }> = {
  'text-green-400':  { border: 'border-l-green-400',  tint: 'from-green-500/5'  },
  'text-blue-400':   { border: 'border-l-blue-400',   tint: 'from-blue-500/5'   },
  'text-purple-400': { border: 'border-l-purple-400', tint: 'from-purple-500/5' },
}

function StatCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string; sub?: string; icon: React.ElementType; color: string
}) {
  const meta = COLOR_META[color] ?? { border: 'border-l-gray-600', tint: 'from-gray-600/5' }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className={`
        bg-gradient-to-br ${meta.tint} to-gray-900
        rounded-xl p-5 border border-gray-800
        border-l-[3px] ${meta.border}
        hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/30
        transition-all duration-200 cursor-default
      `}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-gray-400 text-sm">{label}</span>
        <Icon size={18} className={color} />
      </div>
      <p className="text-2xl font-bold text-gray-100 tabular-nums">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
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
    <div className="p-8 space-y-8">
      {/* Page title with accent underline */}
      <div>
        <h1 className="text-2xl font-bold text-gray-100 inline-block relative">
          Dashboard
          <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-blue-500 to-blue-500/0 -mb-1" />
        </h1>
        <p className="text-gray-500 text-sm mt-2">Portfolio overview &amp; market watchlist</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Total AUM"
          value={`$${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          icon={DollarSign}
          color="text-green-400"
        />
        <StatCard label="Portfolios" value={String(portfolios.length)} icon={Briefcase} color="text-blue-400" />
        <StatCard label="Holdings" value={String(totalHoldings)} icon={TrendingUp} color="text-purple-400" />
      </div>

      {/* Portfolio cards */}
      <section>
        {/* Section header with left bar accent */}
        <div className="flex items-center gap-3 mb-4">
          <span className="w-[3px] h-5 bg-blue-500 rounded-full inline-block" />
          <h2 className="text-lg font-semibold text-gray-200">Your Portfolios</h2>
        </div>

        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : portfolios.length === 0 ? (
          <div className="bg-gray-900 border border-dashed border-gray-700 rounded-xl p-8 text-center">
            <p className="text-gray-400">No portfolios yet.</p>
            <Link to="/portfolio" className="text-blue-400 text-sm hover:underline mt-2 inline-block">
              Create your first portfolio →
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {portfolios.map((p, i) => (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="
                  bg-gray-900 rounded-xl p-5 border border-gray-800
                  hover:border-blue-700/60 hover:-translate-y-0.5
                  hover:shadow-lg hover:shadow-blue-900/20
                  transition-all duration-200 cursor-default
                "
              >
                <p className="font-semibold text-gray-100 truncate">{p.name}</p>
                <p className="text-gray-500 text-xs truncate mt-0.5">{p.description || 'No description'}</p>
                <p className="text-2xl font-bold text-green-400 mt-3 tabular-nums">
                  ${Number(p.totalValue).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </p>
                <p className="text-gray-500 text-xs mt-1">{p.holdings.length} holdings</p>
              </motion.div>
            ))}
          </div>
        )}
      </section>

      {/* Market watchlist */}
      <section>
        {/* Section header with left bar accent */}
        <div className="flex items-center gap-3 mb-4">
          <span className="w-[3px] h-5 bg-blue-500 rounded-full inline-block" />
          <h2 className="text-lg font-semibold text-gray-200">Market Watchlist</h2>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {WATCH_TICKERS.map(ticker => {
            const q = quotes[ticker]
            const isLoading = !(ticker in quotes)
            const isFailed = ticker in quotes && q === null
            const change = q && q.open !== 0 ? ((q.close - q.open) / q.open) * 100 : null
            const isUp = change !== null && change >= 0

            return (
              <div
                key={ticker}
                className="bg-gray-900 rounded-xl p-4 border border-gray-800 hover:-translate-y-0.5 hover:shadow-md transition-all duration-200"
              >
                {/* Ticker row with status dot */}
                <div className="flex items-center gap-1.5">
                  {q && change !== null ? (
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isUp ? 'bg-green-400' : 'bg-red-400'}`} />
                  ) : isFailed ? (
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-yellow-500" />
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-gray-600" />
                  )}
                  <p className="font-mono font-bold text-gray-100 tracking-wider text-sm">{ticker}</p>
                </div>

                {q && change !== null ? (
                  <>
                    <p className="text-lg font-bold mt-2 text-gray-100 tabular-nums">${q.close.toFixed(2)}</p>
                    {/* Pill badge for change percentage */}
                    <span
                      className={`
                        inline-flex items-center gap-1 mt-1.5 px-2 py-0.5
                        rounded-full text-xs font-medium
                        ${isUp
                          ? 'bg-green-500/15 text-green-400'
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
                  <p className="text-gray-600 text-sm mt-1">Loading…</p>
                ) : null}
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
