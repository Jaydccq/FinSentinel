import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { portfolioApi, type PortfolioResponse } from '../api/portfolio'
import { marketApi, type QuoteData } from '../api/market'
import { TrendingUp, TrendingDown, Briefcase, DollarSign } from 'lucide-react'
import { Link } from 'react-router-dom'

const WATCH_TICKERS = ['AAPL', 'MSFT', 'NVDA', 'TSLA']

function StatCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string; sub?: string; icon: React.ElementType; color: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-gray-900 rounded-xl p-5 border border-gray-800"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-gray-400 text-sm">{label}</span>
        <Icon size={18} className={color} />
      </div>
      <p className="text-2xl font-bold text-gray-100">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </motion.div>
  )
}

export default function DashboardPage() {
  const [portfolios, setPortfolios] = useState<PortfolioResponse[]>([])
  const [quotes, setQuotes] = useState<Record<string, QuoteData>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    portfolioApi.list().then(setPortfolios).finally(() => setLoading(false))
    WATCH_TICKERS.forEach(t =>
      marketApi.quote(t).then(q => setQuotes(prev => ({ ...prev, [t]: q }))).catch(() => {})
    )
  }, [])

  const totalValue = portfolios.reduce((s, p) => s + Number(p.totalValue), 0)
  const totalHoldings = portfolios.reduce((s, p) => s + p.holdings.length, 0)

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">Portfolio overview & market watchlist</p>
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
        <h2 className="text-lg font-semibold text-gray-200 mb-4">Your Portfolios</h2>
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
                className="bg-gray-900 rounded-xl p-5 border border-gray-800 hover:border-blue-700 transition-colors"
              >
                <p className="font-semibold text-gray-100 truncate">{p.name}</p>
                <p className="text-gray-500 text-xs truncate mt-0.5">{p.description || 'No description'}</p>
                <p className="text-xl font-bold text-green-400 mt-3">
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
        <h2 className="text-lg font-semibold text-gray-200 mb-4">Market Watchlist</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {WATCH_TICKERS.map(ticker => {
            const q = quotes[ticker]
            const change = q && q.open !== 0 ? ((q.close - q.open) / q.open) * 100 : null
            return (
              <div key={ticker} className="bg-gray-900 rounded-xl p-4 border border-gray-800">
                <p className="font-mono font-bold text-gray-100">{ticker}</p>
                {q && change !== null ? (
                  <>
                    <p className="text-lg font-bold mt-1">${q.close.toFixed(2)}</p>
                    <p className={`text-xs flex items-center gap-1 mt-0.5 ${change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {change >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                      {change.toFixed(2)}%
                    </p>
                  </>
                ) : (
                  <p className="text-gray-600 text-sm mt-1">Loading…</p>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
