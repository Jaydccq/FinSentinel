import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, TrendingUp, TrendingDown, ExternalLink, Sparkles } from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { marketApi, type QuoteData } from '../api/market'
import { newsApi, type NewsSummary, type NewsItemResponse } from '../api/news'
import StockAnalysisSection from '../components/StockAnalysisSection'

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
  POLYGON:           'bg-blue-500/20 text-blue-100 border-blue-300/30',
  RSS_CNBC:          'bg-yellow-500/20 text-yellow-100 border-yellow-300/30',
  RSS_YAHOO:         'bg-violet-500/20 text-violet-100 border-violet-300/30',
  RSS_BBC:           'bg-rose-500/20 text-rose-100 border-rose-300/30',
  RSS_GUARDIAN:      'bg-sky-500/20 text-sky-100 border-sky-300/30',
  RSS_NPR:           'bg-teal-500/20 text-teal-100 border-teal-300/30',
  RSS_REUTERS_PROXY: 'bg-orange-500/20 text-orange-100 border-orange-300/30',
  X_INFLUENCER:      'bg-slate-500/20 text-slate-100 border-slate-300/30',
  RSS_SIGNALHUB:     'bg-indigo-500/20 text-indigo-100 border-indigo-300/30',
  CRYPTO_6551:       'bg-emerald-500/20 text-emerald-100 border-emerald-300/30',
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

  const loadTickerData = useCallback((t: string, crypto: boolean) => {
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
      marketApi.quote(t).catch(() => null),
      marketApi.history(t, 30).catch(() => []),
      newsApi.byTicker(crypto ? t.split('-')[0] : t, 0, 10).catch(() => ({ content: [], totalPages: 0, totalElements: 0, number: 0 })),
      newsApi.summary(t).catch(() => null),
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

    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!ticker) return
    return loadTickerData(ticker, !!isCrypto) // eslint-disable-line react-hooks/set-state-in-effect -- resets state on ticker change
  }, [ticker, isCrypto, loadTickerData])

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
      <Link
        to="/dashboard"
        className="inline-flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] text-sm transition-colors"
      >
        <ArrowLeft size={14} />
        Back to Dashboard
      </Link>

      {/* Header + Quote */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-[var(--bg-panel)] rounded p-6 border border-[var(--border-subtle)]"
      >
        {loading ? (
          <p className="text-[var(--text-muted)]">Loading quote data...</p>
        ) : !quote ? (
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl text-[var(--text-primary)]">{ticker}</h1>
              {isCrypto && (
                <span className="text-xs px-2 py-0.5 rounded bg-orange-500/15 text-orange-300 font-medium border border-orange-400/20">
                  CRYPTO
                </span>
              )}
            </div>
            <p className="text-[var(--warn)] mt-2">Market data unavailable</p>
          </div>
        ) : (
          <>
            <div className="flex items-baseline gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <h1 className="text-3xl text-[var(--text-primary)]">{ticker}</h1>
                {isCrypto && (
                  <span className="text-xs px-2 py-0.5 rounded bg-orange-500/15 text-orange-300 font-medium border border-orange-400/20">
                    CRYPTO
                  </span>
                )}
              </div>
              <span className="text-3xl font-bold text-[var(--text-primary)] font-data tabular-nums">
                ${quote.close.toFixed(2)}
              </span>
              {change !== null && (
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-sm font-medium ${
                    isUp
                      ? 'bg-[color:var(--up)]/15 text-[color:var(--up)]'
                      : 'bg-[color:var(--down)]/15 text-[color:var(--down)]'
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
                { label: 'Open',   value: `$${quote.open.toFixed(2)}` },
                { label: 'High',   value: `$${quote.high.toFixed(2)}` },
                { label: 'Low',    value: `$${quote.low.toFixed(2)}` },
                { label: 'Close',  value: `$${quote.close.toFixed(2)}` },
                { label: 'Volume', value: quote.volume.toLocaleString('en-US') },
              ].map(item => (
                <div key={item.label} className="bg-[var(--bg-elevated)] rounded p-3">
                  <p className="text-[var(--text-muted)] text-xs">{item.label}</p>
                  <p className="text-[var(--text-primary)] font-semibold font-data tabular-nums mt-0.5">{item.value}</p>
                </div>
              ))}
            </div>

            {/* Broker links */}
            <div className="flex items-center gap-3 mt-6">
              <span className="text-[var(--text-muted)] text-xs">Trade on</span>
              {isCrypto ? (
                <>
                  <a
                    href="https://www.binance.com/trade"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--border-subtle)] text-[var(--text-secondary)] text-sm font-medium hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <ExternalLink size={12} />
                    Binance
                  </a>
                  <a
                    href="https://www.coinbase.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--border-subtle)] text-[var(--text-secondary)] text-sm font-medium hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] transition-colors"
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
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--border-subtle)] text-[var(--text-secondary)] text-sm font-medium hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <ExternalLink size={12} />
                    Robinhood
                  </a>
                  <a
                    href={`https://www.interactivebrokers.com/en/index.php?f=2222&exch=smart&ticker=${ticker}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--border-subtle)] text-[var(--text-secondary)] text-sm font-medium hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] transition-colors"
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
        className="bg-[var(--bg-panel)] rounded p-6 border border-[var(--border-subtle)]"
      >
        <div className="flex items-center gap-3 mb-5">
          <span className="w-[2px] h-5 bg-[var(--accent)] inline-block" />
          <h2 className="text-lg text-[var(--text-secondary)]">30-Day Price</h2>
        </div>

        {chartData.length === 0 ? (
          <p className="text-[var(--text-muted)] text-sm">No historical data available.</p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorClose" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
              <XAxis dataKey="date" tick={{ fill: '#52525b', fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis
                domain={['auto', 'auto']}
                tick={{ fill: '#52525b', fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `$${v}`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 4,
                }}
                labelStyle={{ color: 'var(--text-secondary)' }}
                itemStyle={{ color: 'var(--accent)' }}
                formatter={(value: number | undefined) => value != null ? [`$${value.toFixed(2)}`, 'Close'] : ['', 'Close']}
              />
              <Area
                type="monotone"
                dataKey="close"
                stroke="#3b82f6"
                strokeWidth={2}
                fill="url(#colorClose)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </motion.div>

      {/* AI Stock Analysis */}
      <StockAnalysisSection
        ticker={ticker!}
        currentPrice={quote?.close ?? null}
      />

      {/* AI News Brief */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="bg-[var(--bg-panel)] rounded p-6 border border-[var(--border-subtle)]"
      >
        <div className="flex items-center gap-3 mb-4">
          <span className="w-[2px] h-5 bg-purple-500 inline-block" />
          <Sparkles size={16} className="text-purple-400" />
          <h2 className="text-lg text-[var(--text-secondary)]">AI News Brief</h2>
          {summary && (
            <span className="text-[10px] px-2 py-0.5 rounded bg-purple-500/15 text-purple-300">
              {summary.articleCount} articles analyzed
            </span>
          )}
        </div>

        {summaryLoading ? (
          <div className="space-y-2">
            <div className="h-4 bg-[var(--bg-elevated)] rounded animate-pulse w-full" />
            <div className="h-4 bg-[var(--bg-elevated)] rounded animate-pulse w-5/6" />
            <div className="h-4 bg-[var(--bg-elevated)] rounded animate-pulse w-4/6" />
          </div>
        ) : summary?.summary ? (
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{summary.summary}</p>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">No news summary available for {ticker}.</p>
        )}
      </motion.div>

      {/* Related News */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-[var(--bg-panel)] rounded p-6 border border-[var(--border-subtle)]"
      >
        <div className="flex items-center gap-3 mb-5">
          <span className="w-[2px] h-5 bg-[var(--accent)] inline-block" />
          <h2 className="text-lg text-[var(--text-secondary)]">Related News</h2>
        </div>

        {loading ? (
          <p className="text-[var(--text-muted)] text-sm">Loading news...</p>
        ) : news.length === 0 ? (
          <p className="text-[var(--text-muted)] text-sm">No news found for {ticker}.</p>
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
                className="flex items-start justify-between gap-4 p-3 rounded bg-[var(--bg-elevated)] hover:border-[var(--border-subtle)] border border-transparent hover:border-[color:var(--border-subtle)] transition-colors group"
              >
                <div className="min-w-0">
                  <p className="text-[var(--text-primary)] text-sm font-medium truncate group-hover:text-[var(--accent)] transition-colors">
                    {item.title}
                  </p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-[var(--text-muted)]">
                    <span className={`px-1.5 py-0.5 rounded text-xs ${SOURCE_COLORS[item.source] ?? 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]'}`}>
                      {SOURCE_LABELS[item.source] ?? item.source}
                    </span>
                    {item.sentiment && (
                      <span className={`px-1.5 py-0.5 rounded text-xs ${
                        item.sentiment.toUpperCase() === 'POSITIVE' ? 'bg-[color:var(--up)]/15 text-[color:var(--up)]' :
                        item.sentiment.toUpperCase() === 'NEGATIVE' ? 'bg-[color:var(--down)]/15 text-[color:var(--down)]' :
                        'bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
                      }`}>
                        {item.sentiment.charAt(0).toUpperCase() + item.sentiment.slice(1).toLowerCase()}
                      </span>
                    )}
                    <span>{new Date(item.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    {item.author && <span>by {item.author}</span>}
                  </div>
                </div>
                <ExternalLink size={14} className="text-[var(--text-muted)] group-hover:text-[var(--text-secondary)] flex-shrink-0 mt-1" />
              </motion.a>
            ))}

            {hasMoreNews && (
              <button
                onClick={loadMoreNews}
                disabled={loadingMore}
                className="w-full text-center py-2 text-sm text-[var(--accent)] hover:text-blue-400 disabled:opacity-50 transition-colors"
              >
                {loadingMore ? 'Loading...' : 'Load more'}
              </button>
            )}
          </div>
        )}
      </motion.div>
    </div>
  )
}
