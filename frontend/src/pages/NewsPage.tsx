import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { newsApi, type NewsItemResponse, type NewsFeedStats } from '../api/news'
import { Newspaper, Radio, ExternalLink, ChevronDown } from 'lucide-react'

const SOURCE_LABELS: Record<string, string> = {
  POLYGON: 'Polygon',
  RSS_CNBC: 'CNBC',
  RSS_YAHOO: 'Yahoo',
}

const SOURCE_COLORS: Record<string, string> = {
  POLYGON: 'bg-blue-500/15 text-blue-400',
  RSS_CNBC: 'bg-amber-500/15 text-amber-400',
  RSS_YAHOO: 'bg-purple-500/15 text-purple-400',
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

function NewsCard({ item }: { item: NewsItemResponse }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="border-b border-zinc-800/40 py-4 px-1 hover:bg-zinc-900/30 transition-colors"
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-12 text-right">
          <span className="text-xs text-zinc-500 font-data tabular-nums">
            {formatTime(item.publishedAt)}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${SOURCE_COLORS[item.source] ?? 'bg-zinc-700 text-zinc-300'}`}>
              {SOURCE_LABELS[item.source] ?? item.source}
            </span>
            <h3 className="text-sm font-medium text-stone-50 leading-snug">{item.title}</h3>
          </div>

          {item.summary && (
            <p className={`text-xs text-zinc-500 mt-1.5 leading-relaxed ${expanded ? '' : 'line-clamp-2'}`}>
              {item.summary}
            </p>
          )}

          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {item.tickers?.map((t) => (
              <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-data">
                ${t}
              </span>
            ))}
            {item.tags?.slice(0, 3).map((tag) => (
              <span key={tag} className="text-[10px] text-zinc-600">#{tag}</span>
            ))}
            <span className="text-[10px] text-zinc-600 ml-auto">{timeAgo(item.publishedAt)}</span>
            {item.articleUrl && (
              <a
                href={item.articleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-600 hover:text-amber-400 transition-colors"
              >
                <ExternalLink size={12} />
              </a>
            )}
          </div>

          {item.summary && item.summary.length > 160 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[10px] text-zinc-600 hover:text-zinc-400 mt-1 flex items-center gap-0.5"
            >
              <ChevronDown size={10} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
              {expanded ? 'less' : 'more'}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  )
}

export default function NewsPage() {
  const [items, setItems] = useState<NewsItemResponse[]>([])
  const [stats, setStats] = useState<NewsFeedStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [liveCount, setLiveCount] = useState(0)

  useEffect(() => {
    Promise.all([
      newsApi.list(0, 50),
      newsApi.stats(),
    ]).then(([pageData, statsData]) => {
      setItems(pageData.content)
      setTotalPages(pageData.totalPages)
      setStats(statsData)
    }).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const cancel = newsApi.stream((item) => {
      setItems((prev) => [item, ...prev])
      setLiveCount((c) => c + 1)
      setStats((prev) => prev ? { ...prev, todayCount: prev.todayCount + 1, totalCount: prev.totalCount + 1 } : prev)
    })

    return cancel
  }, [])

  const loadMore = useCallback(() => {
    const nextPage = page + 1
    newsApi.list(nextPage, 50).then((pageData) => {
      setItems((prev) => [...prev, ...pageData.content])
      setPage(nextPage)
      setTotalPages(pageData.totalPages)
    })
  }, [page])

  return (
    <div className="p-10 flex gap-8 h-full">
      {/* Left: News feed */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-8">
          <div>
            <h1 className="text-3xl font-display text-stone-50">
              News Feed
            </h1>
            <p className="text-zinc-500 text-sm mt-1">Real-time financial news from multiple sources</p>
          </div>
          {liveCount > 0 && (
            <span className="flex items-center gap-1.5 ml-auto text-xs text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full">
              <Radio size={10} className="animate-pulse" />
              {liveCount} new
            </span>
          )}
        </div>

        {loading ? (
          <div className="text-zinc-500 text-sm py-12 text-center">Loading news...</div>
        ) : items.length === 0 ? (
          <div className="bg-zinc-900 border border-dashed border-zinc-700/50 rounded-xl p-8 text-center">
            <Newspaper size={32} className="text-zinc-600 mx-auto mb-3" />
            <p className="text-zinc-400">No news yet. The feed will populate automatically.</p>
          </div>
        ) : (
          <div className="bg-zinc-900/50 rounded-xl border border-zinc-800/50 overflow-hidden">
            <AnimatePresence initial={false}>
              {items.map((item) => (
                <NewsCard key={item.id} item={item} />
              ))}
            </AnimatePresence>

            {page + 1 < totalPages && (
              <button
                onClick={loadMore}
                className="w-full py-3 text-sm text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/20 transition-colors"
              >
                Load more
              </button>
            )}
          </div>
        )}
      </div>

      {/* Right: Stats panel */}
      <div className="hidden lg:block w-64 flex-shrink-0 space-y-4">
        <div className="sticky top-8 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-[2px] h-5 bg-amber-500 rounded-full inline-block" />
            <h2 className="text-sm font-semibold text-zinc-300">Statistics</h2>
          </div>

          <div className="bg-zinc-900 rounded-xl border border-zinc-800/50 p-4">
            <p className="text-xs text-zinc-500 mb-1">Today</p>
            <p className="text-3xl font-bold text-stone-50 font-data tabular-nums">
              {stats?.todayCount ?? 0}
            </p>
            <p className="text-xs text-zinc-600 mt-0.5">news items</p>
          </div>

          <div className="bg-zinc-900 rounded-xl border border-zinc-800/50 p-4">
            <p className="text-xs text-zinc-500 mb-1">Total</p>
            <p className="text-2xl font-bold text-stone-50 font-data tabular-nums">
              {stats?.totalCount ?? 0}
            </p>
          </div>

          {stats?.countBySource && Object.keys(stats.countBySource).length > 0 && (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/50 p-4">
              <p className="text-xs text-zinc-500 mb-3">By Source (Today)</p>
              <div className="space-y-2">
                {Object.entries(stats.countBySource).map(([source, count]) => (
                  <div key={source} className="flex items-center justify-between">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${SOURCE_COLORS[source] ?? 'bg-zinc-700 text-zinc-300'}`}>
                      {SOURCE_LABELS[source] ?? source}
                    </span>
                    <span className="text-sm font-semibold text-zinc-300 font-data tabular-nums">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-zinc-900 rounded-xl border border-zinc-800/50 p-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-zinc-400">Live feed connected</span>
          </div>
        </div>
      </div>
    </div>
  )
}
