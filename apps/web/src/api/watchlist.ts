import { apiFetch } from './client'
import type {
  SaveWatchlistRequest,
  WatchlistCategoryResponse,
  WatchlistOverviewResponse,
} from '@finsentinel/shared'

/**
 * Watchlist HTTP client. Backed by the NestJS WatchlistController which
 * delegates straight to WatchlistService — same surface that the agent
 * tools have been using internally.
 */
export const watchlistApi = {
  list: (): Promise<WatchlistOverviewResponse> => apiFetch('/watchlist'),

  save: (body: SaveWatchlistRequest): Promise<WatchlistCategoryResponse> =>
    apiFetch('/watchlist', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
}

export type {
  SaveWatchlistRequest,
  WatchlistOverviewResponse,
  WatchlistCategoryResponse,
}
