import { apiFetch, BASE, authHeaders } from './client'

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

export const newsApi = {
  list: (page = 0, size = 50, source?: string) => {
    const params = new URLSearchParams({ page: String(page), size: String(size) })
    if (source) params.set('source', source)
    return apiFetch<NewsPage>(`/news?${params}`)
  },

  stats: () => apiFetch<NewsFeedStats>('/news/stats'),

  stream: (onNews: (item: NewsItemResponse) => void, onError?: (err: Event) => void) => {
    const token = localStorage.getItem('jwt_token')
    const url = `${BASE}/news/stream`

    const eventSource = new EventSource(url)

    eventSource.addEventListener('news', (event) => {
      try {
        const item: NewsItemResponse = JSON.parse(event.data)
        onNews(item)
      } catch {
        // ignore parse errors
      }
    })

    eventSource.onerror = (err) => {
      onError?.(err)
    }

    return eventSource
  },
}
