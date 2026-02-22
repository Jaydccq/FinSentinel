import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Newspaper,
  Radio,
  ExternalLink,
  ChevronDown,
  Filter,
  CircleDot,
  Search,
  X,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { newsApi, type NewsItemResponse, type NewsFeedStats } from '../api/news'
import { NewsListSkeleton } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'

const SOURCE_LABELS: Record<string, string> = {
  POLYGON: 'Polygon',
  RSS_CNBC: 'CNBC',
  RSS_YAHOO: 'Yahoo Finance',
}

const SOURCE_COLORS: Record<string, string> = {
  POLYGON: 'bg-blue-500/20 text-blue-100 border-blue-300/30',
  RSS_CNBC: 'bg-amber-500/20 text-amber-100 border-amber-300/30',
  RSS_YAHOO: 'bg-violet-500/20 text-violet-100 border-violet-300/30',
}

const SENTIMENT_STYLE: Record<string, string> = {
  POSITIVE: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/25',
  NEGATIVE: 'bg-red-500/15 text-red-300 border-red-400/25',
  NEUTRAL: 'bg-slate-600/20 text-slate-300 border-slate-400/25',
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function SentimentBadge({ sentiment }: { sentiment: string | null }) {
  if (!sentiment) return null
  const upper = sentiment.toUpperCase()
  const style = SENTIMENT_STYLE[upper]
  if (!style) return null

  return (
    <span className={`status-chip border ${style}`}>
      {sentiment.charAt(0).toUpperCase() + sentiment.slice(1).toLowerCase()}
    </span>
  )
}

function EnrichedDot({ enriched }: { enriched: boolean }) {
  return (
    <span
      title={enriched ? 'Fully indexed for RAG' : 'Raw headline — not yet enriched'}
      className={`inline-flex items-center gap-1 text-[11px] ${
        enriched ? 'text-emerald-300' : 'text-[var(--text-muted)]'
      }`}
    >
      {enriched ? (
        <Zap size={10} className="text-emerald-400" />
      ) : (
        <span className="h-1.5 w-1.5 rounded-full bg-slate-600 inline-block" />
      )}
    </span>
  )
}

function NewsCard({ item }: { item: NewsItemResponse }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="surface-panel rounded-2xl p-4 md:p-5"
    >
      <div className="flex items-start gap-3">
        <div className="hidden sm:block text-right min-w-14">
          <p className="text-xs text-[var(--text-muted)] font-data">{formatTime(item.publishedAt)}</p>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`status-chip border ${SOURCE_COLORS[item.source] ?? 'bg-slate-700/50 text-slate-100 border-slate-400/30'}`}>
              {SOURCE_LABELS[item.source] ?? item.source}
            </span>
            <SentimentBadge sentiment={item.sentiment} />
            <EnrichedDot enriched={item.enriched} />
            <h3 className="text-sm md:text-[15px] font-semibold text-[var(--text-primary)] leading-snug">{item.title}</h3>
          </div>

          {item.summary && (
            <p className={`text-sm text-[var(--text-secondary)] mt-2 leading-relaxed ${expanded ? '' : 'line-clamp-2'}`}>
              {item.summary}
            </p>
          )}

          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {item.tickers?.slice(0, 4).map(ticker => (
              <span key={ticker} className="status-chip bg-cyan-500/12 text-cyan-100 border-cyan-400/20 font-data">
                ${ticker}
              </span>
            ))}
            {item.tags?.slice(0, 2).map(tag => (
              <span key={tag} className="text-[11px] text-[var(--text-muted)]">#{tag}</span>
            ))}
            <span className="text-[11px] text-[var(--text-muted)] ml-auto">{timeAgo(item.publishedAt)}</span>
            {item.articleUrl && (
              <a
                href={item.articleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="h-7 w-7 rounded-lg inline-flex items-center justify-center text-[var(--text-muted)] hover:text-amber-100 hover:bg-amber-400/15 transition-colors"
                aria-label="Open article"
              >
                <ExternalLink size={13} />
              </a>
            )}
          </div>

          {item.summary && item.summary.length > 160 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] inline-flex items-center gap-1"
            >
              <ChevronDown size={11} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      </div>
    </motion.article>
  )
}

export default function NewsPage() {
  const [items, setItems] = useState<NewsItemResponse[]>([])
  const [stats, setStats] = useState<NewsFeedStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [liveCount, setLiveCount] = useState(0)
  const [sourceFilter, setSourceFilter] = useState<string>('ALL')
  const [sentimentFilter, setSentimentFilter] = useState<string>('ALL')
  const [tickerSearch, setTickerSearch] = useState('')
  const [tickerActive, setTickerActive] = useState('')
  const tickerActiveRef = useRef(tickerActive)
  useEffect(() => { tickerActiveRef.current = tickerActive }, [tickerActive])

  useEffect(() => {
    Promise.all([newsApi.list(0, 50), newsApi.stats()])
      .then(([pageData, statsData]) => {
        setItems(pageData.content)
        setTotalPages(pageData.totalPages)
        setStats(statsData)
      })
      .catch(() => toast.error('Failed to load news feed.'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const cancel = newsApi.stream((item) => {
      // Skip items that don't match the active ticker filter
      const activeTicker = tickerActiveRef.current
      if (activeTicker && !item.tickers?.includes(activeTicker)) {
        // Still update stats (global count), but don't insert into list
        setStats(prev => prev
          ? { ...prev, todayCount: prev.todayCount + 1, totalCount: prev.totalCount + 1 }
          : prev)
        return
      }

      setItems(prev => [item, ...prev])
      setLiveCount(count => count + 1)
      setStats(prev => prev
        ? { ...prev, todayCount: prev.todayCount + 1, totalCount: prev.totalCount + 1 }
        : prev)
    })

    return cancel
  }, [])

  // Fetch by ticker when ticker filter is activated
  const searchByTicker = useCallback(() => {
    const ticker = tickerSearch.trim().toUpperCase()
    if (!ticker) return
    setLoading(true)
    setTickerActive(ticker)
    newsApi.byTicker(ticker, 0, 50)
      .then(pageData => {
        setItems(pageData.content)
        setTotalPages(pageData.totalPages)
        setPage(0)
      })
      .catch(() => toast.error(`No news found for ${ticker}.`))
      .finally(() => setLoading(false))
  }, [tickerSearch])

  const clearTicker = useCallback(() => {
    setTickerSearch('')
    setTickerActive('')
    setLoading(true)
    newsApi.list(0, 50)
      .then(pageData => {
        setItems(pageData.content)
        setTotalPages(pageData.totalPages)
        setPage(0)
      })
      .finally(() => setLoading(false))
  }, [])

  const filteredItems = useMemo(() => {
    let filtered = items
    if (sourceFilter !== 'ALL') {
      filtered = filtered.filter(item => item.source === sourceFilter)
    }
    if (sentimentFilter !== 'ALL') {
      filtered = filtered.filter(item => {
        const s = item.sentiment?.toUpperCase()
        return s === sentimentFilter
      })
    }
    return filtered
  }, [items, sourceFilter, sentimentFilter])

  const sources = useMemo(() => {
    const set = new Set(items.map(item => item.source))
    return ['ALL', ...Array.from(set)]
  }, [items])

  const loadMore = useCallback(() => {
    const nextPage = page + 1
    const fetcher = tickerActive
      ? newsApi.byTicker(tickerActive, nextPage, 50)
      : newsApi.list(nextPage, 50)

    fetcher.then(pageData => {
      setItems(prev => [...prev, ...pageData.content])
      setPage(nextPage)
      setTotalPages(pageData.totalPages)
    })
  }, [page, tickerActive])

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-5">
      <section className="space-y-5">
        <div className="glass-panel rounded-3xl p-6 md:p-7">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-xs uppercase tracking-[0.13em] text-amber-200/80">Market Signal</p>
              <h1 className="page-title mt-3">News Feed</h1>
              <p className="page-subtitle">Live financial headlines prioritized by relevance and source diversity.</p>
            </div>

            <div className="flex items-center gap-2">
              <span className="status-chip bg-emerald-500/12 border-emerald-300/25 text-emerald-100">
                <Radio size={12} className="animate-pulse" />
                Live stream
              </span>
              {liveCount > 0 && (
                <span className="status-chip bg-cyan-500/12 border-cyan-300/25 text-cyan-100">
                  +{liveCount} new
                </span>
              )}
            </div>
          </div>

          <div className="section-divider my-4" />

          {/* Ticker search */}
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs uppercase tracking-[0.1em] text-[var(--text-muted)] inline-flex items-center gap-1.5">
              <Search size={12} /> Ticker
            </span>
            <div className="relative flex-1 max-w-[200px]">
              <input
                className="field-input py-1.5 pr-8 text-xs font-data uppercase"
                placeholder="e.g. AAPL"
                value={tickerSearch}
                onChange={e => setTickerSearch(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && searchByTicker()}
                maxLength={5}
              />
              {tickerActive && (
                <button
                  onClick={clearTicker}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  aria-label="Clear ticker filter"
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <button
              onClick={searchByTicker}
              disabled={!tickerSearch.trim()}
              className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-40"
            >
              Filter
            </button>
            {tickerActive && (
              <span className="status-chip bg-cyan-500/12 border-cyan-400/20 text-cyan-100 font-data">
                ${tickerActive}
              </span>
            )}
          </div>

          {/* Source filter */}
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <span className="text-xs uppercase tracking-[0.1em] text-[var(--text-muted)] inline-flex items-center gap-1.5">
              <Filter size={12} /> Source
            </span>
            {sources.map(source => (
              <button
                key={source}
                onClick={() => setSourceFilter(source)}
                className={`status-chip border transition-colors ${
                  sourceFilter === source
                    ? 'bg-amber-400/18 border-amber-300/30 text-amber-100'
                    : 'bg-slate-800/30 border-[color:var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {source === 'ALL' ? 'All' : (SOURCE_LABELS[source] ?? source)}
              </button>
            ))}
          </div>

          {/* Sentiment filter */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs uppercase tracking-[0.1em] text-[var(--text-muted)] inline-flex items-center gap-1.5">
              <Filter size={12} /> Sentiment
            </span>
            {['ALL', 'POSITIVE', 'NEGATIVE', 'NEUTRAL'].map(s => (
              <button
                key={s}
                onClick={() => setSentimentFilter(s)}
                className={`status-chip border transition-colors ${
                  sentimentFilter === s
                    ? 'bg-amber-400/18 border-amber-300/30 text-amber-100'
                    : 'bg-slate-800/30 border-[color:var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {s === 'ALL' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <NewsListSkeleton />
        ) : filteredItems.length === 0 ? (
          <EmptyState
            icon={<Newspaper size={30} />}
            title="No news in this filter yet."
            description="Try adjusting your filters or check back later."
          />
        ) : (
          <div className="space-y-3">
            <AnimatePresence initial={false}>
              {filteredItems.map(item => (
                <NewsCard key={item.id} item={item} />
              ))}
            </AnimatePresence>

            {page + 1 < totalPages && (
              <button onClick={loadMore} className="btn-ghost w-full py-2.5 text-sm">
                Load more
              </button>
            )}
          </div>
        )}
      </section>

      <aside className="space-y-4 xl:sticky xl:top-24 xl:h-fit">
        <div className="surface-panel rounded-2xl p-4">
          <p className="text-xs uppercase tracking-[0.1em] text-[var(--text-muted)]">Today</p>
          <p className="kpi-value mt-2">{stats?.todayCount ?? 0}</p>
          <p className="text-xs text-[var(--text-secondary)]">headline items</p>
        </div>

        <div className="surface-panel rounded-2xl p-4">
          <p className="text-xs uppercase tracking-[0.1em] text-[var(--text-muted)]">Total</p>
          <p className="kpi-value mt-2">{stats?.totalCount ?? 0}</p>
        </div>

        <div className="surface-panel rounded-2xl p-4">
          <p className="text-xs uppercase tracking-[0.1em] text-[var(--text-muted)] mb-3">By Source</p>
          <div className="space-y-2.5">
            {stats?.countBySource && Object.entries(stats.countBySource).length > 0 ? (
              Object.entries(stats.countBySource).map(([source, count]) => (
                <div key={source} className="flex items-center justify-between">
                  <span className={`status-chip border ${SOURCE_COLORS[source] ?? 'bg-slate-700/50 text-slate-100 border-slate-400/30'}`}>
                    {SOURCE_LABELS[source] ?? source}
                  </span>
                  <span className="text-sm font-data text-[var(--text-secondary)]">{count}</span>
                </div>
              ))
            ) : (
              <p className="text-sm text-[var(--text-muted)]">No stats available.</p>
            )}
          </div>
        </div>

        <div className="surface-panel rounded-2xl p-4 flex items-center gap-2.5 text-sm text-[var(--text-secondary)]">
          <CircleDot size={14} className="text-emerald-300" />
          Stream connection active
        </div>
      </aside>
    </div>
  )
}
