import { routes } from './registry';
import { typedFetch } from './typed-client';
import type {
  SaveWatchlistRequest,
  UpdateWatchlistCategoryRequest,
  UpdateWatchlistItemRequest,
  WatchlistCategoryResponse,
  WatchlistItemResponse,
  WatchlistOverviewResponse,
} from '@finsentinel/shared';

/**
 * Watchlist HTTP client. Backed by the NestJS WatchlistController which
 * delegates straight to WatchlistService.
 *
 * As of 2026-04-25 this client routes through `typedFetch` against the
 * route registry so every response is validated against the shared Zod
 * schema at runtime — silent JSON drift now surfaces as
 * `ResponseValidationError` instead of corrupting downstream caches.
 */
export const watchlistApi = {
  list: (): Promise<WatchlistOverviewResponse> => typedFetch({ ...routes.watchlist.list }),

  save: (body: SaveWatchlistRequest): Promise<WatchlistCategoryResponse> =>
    typedFetch({ ...routes.watchlist.save, body }),

  updateItem: (id: string, body: UpdateWatchlistItemRequest): Promise<WatchlistItemResponse> =>
    typedFetch({
      ...routes.watchlist.updateItem,
      path: routes.watchlist.updateItem.path.replace(':id', encodeURIComponent(id)),
      body,
    }),

  deleteItem: (id: string): Promise<void> =>
    typedFetch({
      ...routes.watchlist.deleteItem,
      path: routes.watchlist.deleteItem.path.replace(':id', encodeURIComponent(id)),
    }) as Promise<void>,

  updateCategory: (
    id: string,
    body: UpdateWatchlistCategoryRequest,
  ): Promise<WatchlistCategoryResponse> =>
    typedFetch({
      ...routes.watchlist.updateCategory,
      path: routes.watchlist.updateCategory.path.replace(':id', encodeURIComponent(id)),
      body,
    }),

  deleteCategory: (id: string): Promise<void> =>
    typedFetch({
      ...routes.watchlist.deleteCategory,
      path: routes.watchlist.deleteCategory.path.replace(':id', encodeURIComponent(id)),
    }) as Promise<void>,
};

export type {
  SaveWatchlistRequest,
  UpdateWatchlistCategoryRequest,
  UpdateWatchlistItemRequest,
  WatchlistCategoryResponse,
  WatchlistItemResponse,
  WatchlistOverviewResponse,
};
