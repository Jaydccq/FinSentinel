'use client';

import useSWR from 'swr';
import { watchlistApi } from '../../api/watchlist';
import type {
  SaveWatchlistRequest,
  UpdateWatchlistItemRequest,
} from '@finsentinel/shared';

/**
 * Stable SWR cache key for the full watchlist overview. Tuple form
 * keeps it collision-free against other domains.
 */
const key = ['watchlist', 'overview'] as const;

/**
 * SWR-backed watchlist hook. Wraps `watchlistApi.list()` and exposes
 * write helpers (`save`, `updateItem`, `deleteItem`) that revalidate the
 * cache on success — call sites no longer need to call `list()` again
 * manually after a write.
 */
export function useWatchlist() {
  const swr = useSWR(key, () => watchlistApi.list());
  return {
    ...swr,
    save: async (body: SaveWatchlistRequest) => {
      const res = await watchlistApi.save(body);
      await swr.mutate();
      return res;
    },
    updateItem: async (id: string, body: UpdateWatchlistItemRequest) => {
      const res = await watchlistApi.updateItem(id, body);
      await swr.mutate();
      return res;
    },
    deleteItem: async (id: string) => {
      await watchlistApi.deleteItem(id);
      await swr.mutate();
    },
  };
}

useWatchlist.key = key;
