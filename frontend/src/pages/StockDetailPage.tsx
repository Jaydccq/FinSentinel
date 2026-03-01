import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, TrendingUp, TrendingDown, ExternalLink, Sparkles } from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { marketApi, type QuoteData } from '../api/market'
import { newsApi, type NewsSummary, type NewsItemResponse } from '../api/news'

interface HistoryBar {
  t: number; o: number; h: number; l: number; c: number; v: number
}

const SOURCE_LABELS: Record<string, string> = {
  POLYGON: 'Polygon',
  RSS_CNBC: 'CNBC',
  RSS_YAHOO: 'Yahoo Finance',
  RSS_BBC: 'BBC',
  RSS_GUARDIAN: 'Guardian',
  RSS_NPR: 'NPR',
  RSS_REUTERS_PROXY: 'Reuters',
  X_INFLUENCER: 'X / Twitter',
  RSS_SIGNALHUB: 'SignalHub',
  CRYPTO_6551: 'Crypto 6551',
}

const SOURCE_COLORS: Record<string, string> = {
  POLYGON: 'bg-blue-500/20 text-blue-100 border-blue-300/30',
  RSS_CNBC: 'bg-amber-500/20 text-amber-100 border-amber-300/30',
  RSS_YAHOO: 'bg-violet-500/20 text-violet-100 border-violet-300/30',
  RSS_BBC: 'bg-rose-500/20 text-rose-100 border-rose-300/30',
  RSS_GUARDIAN: 'bg-sky-500/20 text-sky-100 border-sky-300/30',
  RSS_NPR: 'bg-teal-500/20 text-teal-100 border-teal-300/30',
  RSS_REUTERS_PROXY: 'bg-orange-500/20 text-orange-100 border-orange-300/30',
  X_INFLUENCER: 'bg-slate-500/20 text-slate-100 border-slate-300/30',
  RSS_SIGNALHUB: 'bg-indigo-500/20 text-indigo-100 border-indigo-300/30',
  CRYPTO_6551: 'bg-emerald-500/20 text-emerald-100 border-emerald-300/30',
}

export default function StockDetailPage() {
  const { ticker } = useParams<{ ticker: string }>()
  const isCrypto = ticker?.includes('-')
  const requestVersionRef = useRef(0)
  const [quote, setQuote] = useState<QuoteData | null>(null)
  const [history, setHistory] = useState<HistoryBar[]>([])
  const [news, setNews] = useState<NewsItemResponse[]>([])
  const [newsPage, setNewsPage] = useState(0)
  const [hasMoreNews, setHasMoreNews] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<NewsSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(true)

  useEffect(() => {
    if (!ticker) return
    const requestVersion = ++requestVersionRef.current
    let cancelled = false

    setLoading(true)
    setLoadingMore(false)
    setQuote(null)
    setHistory([])
    setNews([])
    setNewsPage(0)
    setHasMoreNews(true)
    setSummary(null)
    setSummaryLoading(true)

    Promise.all([
      marketApi.quote(ticker).catch(() => null),
      marketApi.history(ticker, 30).catch(() => []),
      newsApi.byTicker(isCrypto ? ticker.split('-')[0] : ticker, 0, 10).catch(() => ({ content: [], totalPages: 0, totalElements: 0, number: 0 })),
      newsApi.summary(ticker).catch(() => null),
    ]).then(([q, h, n, s]) => {
      if (cancelled || requestVersion !== requestVersionRef.current) return
      setQuote(q)
      setHistory(h)
      setNews(n.content)
      setHasMoreNews(n.totalPages > 1)
      setSummary(s)
    }).finally(() => {
      if (cancelled || requestVersion !== requestVersionRef.current) return
      setLoading(false)
      setSummaryLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [ticker])

  const loadMoreNews = () => {
    if (!ticker || loadingMore) return
    const requestVersion = requestVersionRef.current
    setLoadingMore(true)
    const next = newsPage + 1
    newsApi.byTicker(isCrypto ? ticker!.split('-')[0] : ticker!, next, 10).then(n => {
      if (requestVersion !== requestVersionRef.current) return
      setNews(prev => {
        const existingIds = new Set(prev.map(item => item.id))
        const deduped = n.content.filter(item => !existingIds.has(item.id))
        return [...prev, ...deduped]
      })
      setNewsPage(next)
      setHasMoreNews(next + 1 < n.totalPages)
    }).finally(() => {
      if (requestVersion !== requestVersionRef.current) return
      setLoadingMore(false)
    })
  }

  const change = quote && quote.open !== 0
    ? ((quote.close - quote.open) / quote.open) * 100
    : null
  const isUp = change !== null && change >= 0

  const chartData = history.map(bar => ({
    date: new Date(bar.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    close: bar.c,
  }))

  return (
    <div className="p-10 space-y-8 max-w-5xl mx-auto">
      {/* Back link */}
      <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-zinc-500 hover:text-zinc-200 text-sm transition-colors">
        <ArrowLeft size={14} />
        Back to Dashboard
      </Link>

      {/* Header + Quote */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-zinc-900 rounded-xl p-6 border border-zinc-800/50"
      >
        {loading ? (
          <p className="text-zinc-500">Loading quote data...</p>
        ) : !quote ? (
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-display text-stone-50">{ticker}</h1>
              {isCrypto && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-300 font-medium border border-orange-400/20">
                  CRYPTO
                </span>
              )}
            </div>
            <p className="text-yellow-600 mt-2">Market data unavailable</p>
          </div>
        ) : (
          <>
            <div className="flex items-baseline gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-display text-stone-50">{ticker}</h1>
                {isCrypto && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-300 font-medium border border-orange-400/20">
                    CRYPTO
                  </span>
                )}
              </div>
              <span className="text-3xl font-bold text-stone-50 font-data tabular-nums">
                ${quote.close.toFixed(2)}
              </span>
              {change !== null && (
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm font-medium ${
                    isUp ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                  }`}
                >
                  {isUp ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                  {isUp ? '+' : ''}{change.toFixed(2)}%
                </span>
              )}
            </div>

            {/* OHLC + Volume grid */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mt-6">
              {[
                { label: 'Open', value: `$${quote.open.toFixed(2)}` },
                { label: 'High', value: `$${quote.high.toFixed(2)}` },
                { label: 'Low', value: `$${quote.low.toFixed(2)}` },
                { label: 'Close', value: `$${quote.close.toFixed(2)}` },
                { label: 'Volume', value: quote.volume.toLocaleString('en-US') },
              ].map(item => (
                <div key={item.label} className="bg-zinc-800/40 rounded-lg p-3">
                  <p className="text-zinc-500 text-xs">{item.label}</p>
                  <p className="text-zinc-200 font-semibold font-data tabular-nums mt-0.5">{item.value}</p>
                </div>
              ))}
            </div>

            {/* Broker links */}
            <div className="flex items-center gap-3 mt-6">
              <span className="text-zinc-500 text-xs">Trade on</span>
              {isCrypto ? (
                <>
                  <a
                    href="https://www.binance.com/trade"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700/50 text-zinc-300 text-sm font-medium hover:border-zinc-600 hover:text-stone-50 transition-all duration-200"
                  >
                    <ExternalLink size={12} />
                    Binance
                  </a>
                  <a
                    href="https://www.coinbase.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700/50 text-zinc-300 text-sm font-medium hover:border-zinc-600 hover:text-stone-50 transition-all duration-200"
                  >
                    <ExternalLink size={12} />
                    Coinbase
                  </a>
                </>
              ) : (
                <>
                  <a
                    href={`https://robinhood.com/stocks/${ticker}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700/50 text-zinc-300 text-sm font-medium hover:border-zinc-600 hover:text-stone-50 transition-all duration-200"
                  >
                    <ExternalLink size={12} />
                    Robinhood
                  </a>
                  <a
                    href={`https://www.interactivebrokers.com/en/index.php?f=2222&exch=smart&ticker=${ticker}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700/50 text-zinc-300 text-sm font-medium hover:border-zinc-600 hover:text-stone-50 transition-all duration-200"
                  >
                    <ExternalLink size={12} />
                    IBKR
                  </a>
                </>
              )}
            </div>
          </>
        )}
      </motion.div>

      {/* Price Chart */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="bg-zinc-900 rounded-xl p-6 border border-zinc-800/50"
      >
        <div className="flex items-center gap-3 mb-5">
          <span className="w-[2px] h-5 bg-amber-500 rounded-full inline-block" />
          <h2 className="text-lg font-display text-zinc-200">30-Day Price</h2>
        </div>

        {chartData.length === 0 ? (
          <p className="text-zinc-500 text-sm">No historical data available.</p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorClose" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#c4a35a" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#c4a35a" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
              <XAxis dataKey="date" tick={{ fill: '#71717a', fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis
                domain={['auto', 'auto']}
                tick={{ fill: '#71717a', fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `$${v}`}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: 8 }}
                labelStyle={{ color: '#a1a1aa' }}
                itemStyle={{ color: '#c4a35a' }}
                formatter={(value: number | undefined) => value != null ? [`$${value.toFixed(2)}`, 'Close'] : ['', 'Close']}
              />
              <Area
                type="monotone"
                dataKey="close"
                stroke="#c4a35a"
                strokeWidth={2}
                fill="url(#colorClose)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </motion.div>

      {/* AI News Brief */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="bg-zinc-900 rounded-xl p-6 border border-zinc-800/50"
      >
        <div className="flex items-center gap-3 mb-4">
          <span className="w-[2px] h-5 bg-purple-500 rounded-full inline-block" />
          <Sparkles size={16} className="text-purple-400" />
          <h2 className="text-lg font-display text-zinc-200">AI News Brief</h2>
          {summary && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300">
              {summary.articleCount} articles analyzed
            </span>
          )}
        </div>

        {summaryLoading ? (
          <div className="space-y-2">
            <div className="h-4 bg-zinc-800 rounded animate-pulse w-full" />
            <div className="h-4 bg-zinc-800 rounded animate-pulse w-5/6" />
            <div className="h-4 bg-zinc-800 rounded animate-pulse w-4/6" />
          </div>
        ) : summary?.summary ? (
          <p className="text-sm text-zinc-300 leading-relaxed">{summary.summary}</p>
        ) : (
          <p className="text-sm text-zinc-500">No news summary available for {ticker}.</p>
        )}
      </motion.div>

      {/* Related News */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-zinc-900 rounded-xl p-6 border border-zinc-800/50"
      >
        <div className="flex items-center gap-3 mb-5">
          <span className="w-[2px] h-5 bg-amber-500 rounded-full inline-block" />
          <h2 className="text-lg font-display text-zinc-200">Related News</h2>
        </div>

        {loading ? (
          <p className="text-zinc-500 text-sm">Loading news...</p>
        ) : news.length === 0 ? (
          <p className="text-zinc-500 text-sm">No news found for {ticker}.</p>
        ) : (
          <div className="space-y-3">
            {news.map((item, i) => (
              <motion.a
                key={item.id}
                href={item.articleUrl}
                target="_blank"
                rel="noopener noreferrer"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.03 }}
                className="flex items-start justify-between gap-4 p-3 rounded-lg bg-zinc-800/30 hover:bg-zinc-800/60 border border-transparent hover:border-zinc-700/50 transition-all duration-200 group"
              >
                <div className="min-w-0">
                  <p className="text-zinc-200 text-sm font-medium truncate group-hover:text-amber-400 transition-colors">
                    {item.title}
                  </p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-zinc-500">
                    <span className={`px-1.5 py-0.5 rounded text-xs ${SOURCE_COLORS[item.source] ?? 'bg-zinc-700/40 text-zinc-400'}`}>
                      {SOURCE_LABELS[item.source] ?? item.source}
                    </span>
                    {item.sentiment && (
                      <span className={`px-1.5 py-0.5 rounded text-xs ${
                        item.sentiment.toUpperCase() === 'POSITIVE' ? 'bg-emerald-500/15 text-emerald-300' :
                        item.sentiment.toUpperCase() === 'NEGATIVE' ? 'bg-red-500/15 text-red-300' :
                        'bg-slate-600/20 text-slate-300'
                      }`}>
                        {item.sentiment.charAt(0).toUpperCase() + item.sentiment.slice(1).toLowerCase()}
                      </span>
                    )}
                    <span>{new Date(item.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    {item.author && <span>by {item.author}</span>}
                  </div>
                </div>
                <ExternalLink size={14} className="text-zinc-600 group-hover:text-zinc-400 flex-shrink-0 mt-1" />
              </motion.a>
            ))}

            {hasMoreNews && (
              <button
                onClick={loadMoreNews}
                disabled={loadingMore}
                className="w-full text-center py-2 text-sm text-amber-400/80 hover:text-amber-400 disabled:opacity-50 transition-colors"
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            )}
          </div>
        )}
      </motion.div>
    </div>
  )
}
