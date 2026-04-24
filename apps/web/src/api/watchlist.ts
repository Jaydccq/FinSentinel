import { apiFetch } from './client'
import type {
  SaveWatchlistRequest,
  UpdateWatchlistCategoryRequest,
  UpdateWatchlistItemRequest,
  WatchlistCategoryResponse,
  WatchlistItemResponse,
  WatchlistOverviewResponse,
} from '@finsentinel/shared'

/**
 * Watchlist HTTP client. Backed by the NestJS WatchlistController which
 * delegates straight to WatchlistService — same surface that the agent
 * tools have been using internally.
 *
 * F-6 adds the item + category-level CRUD the backend landed earlier;
 * see `docs/exec-plans/2026-04-24-deferred-followups.md` §F-6.
 */
export const watchlistApi = {
  list: (): Promise<WatchlistOverviewResponse> => apiFetch('/watchlist'),

  save: (body: SaveWatchlistRequest): Promise<WatchlistCategoryResponse> =>
    apiFetch('/watchlist', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateItem: (
    id: string,
    patch: UpdateWatchlistItemRequest,
  ): Promise<WatchlistItemResponse> =>
    apiFetch(`/watchlist/items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteItem: (id: string): Promise<void> =>
    apiFetch(`/watchlist/items/${id}`, { method: 'DELETE' }),

  updateCategory: (
    id: string,
    patch: UpdateWatchlistCategoryRequest,
  ): Promise<WatchlistCategoryResponse> =>
    apiFetch(`/watchlist/categories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteCategory: (id: string): Promise<void> =>
    apiFetch(`/watchlist/categories/${id}`, { method: 'DELETE' }),
}

export type {
  SaveWatchlistRequest,
  UpdateWatchlistCategoryRequest,
  UpdateWatchlistItemRequest,
  WatchlistCategoryResponse,
  WatchlistItemResponse,
  WatchlistOverviewResponse,
}
