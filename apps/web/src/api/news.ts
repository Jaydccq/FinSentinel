import { apiFetch, resolveBase, authHeaders } from './client'

export interface NewsItemResponse {
  id: string
  sourceId: string
  source: string
  title: string
  summary: string
  articleUrl: string
  author: string
  publishedAt: string
  tickers: string[]
  tags: string[]
  sentiment: string | null
  enriched: boolean
}

export interface NewsPage {
  content: NewsItemResponse[]
  totalPages: number
  totalElements: number
  number: number
}

export interface NewsFeedStats {
  todayCount: number
  totalCount: number
  countBySource: Record<string, number>
}

export interface NewsSummary {
  ticker: string
  summary: string
  articleCount: number
  generatedAt: string
}

export const newsApi = {
  list: (page = 0, size = 50, source?: string) => {
    const params = new URLSearchParams({ page: String(page), size: String(size) })
    if (source) params.set('source', source)
    return apiFetch<NewsPage>(`/news?${params}`)
  },

  stats: () => apiFetch<NewsFeedStats>('/news/stats'),

  byTicker: (ticker: string, page = 0, size = 20) =>
    apiFetch<NewsPage>(`/news/by-ticker/${encodeURIComponent(ticker)}?page=${page}&size=${size}`),

  summary: (ticker: string) =>
    apiFetch<NewsSummary>(`/news/summary/${encodeURIComponent(ticker)}`),

  stream: (
    onNews: (item: NewsItemResponse) => void,
    onHeartbeat?: () => void,
    onError?: (err: string) => void
  ): (() => void) => {
    let cancelled = false

    async function connect() {
      try {
        const res = await fetch(`${resolveBase()}/news/stream`, {
          credentials: 'include',
          headers: {
            Accept: 'text/event-stream',
            ...authHeaders(),
          },
        })

        if (!res.ok) {
          onError?.(`HTTP ${res.status}`)
          return
        }

        const reader = res.body!.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (!cancelled) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          let eventName = ''
          for (const line of lines) {
            if (line.startsWith('event:')) {
              eventName = line.slice(6).trim()
            } else if (line.startsWith('data:')) {
              const data = line.slice(5).trim()
              if (eventName === 'news') {
                try {
                  const item: NewsItemResponse = JSON.parse(data)
                  onNews(item)
                } catch {
                  // ignore parse errors
                }
              } else if (eventName === 'heartbeat') {
                onHeartbeat?.()
              }
            } else if (line === '') {
              eventName = ''
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          onError?.(err instanceof Error ? err.message : 'Connection failed')
        }
      }
    }

    connect()

    return () => {
      cancelled = true
    }
  },
}
