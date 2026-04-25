'use client';

import useSWR from 'swr';
import { portfolioApi } from '../../api/portfolio';

/**
 * Stable SWR cache key for the portfolio list. Tuple form
 * (`[domain, action]`) avoids accidental collisions with other hooks.
 */
const key = ['portfolios', 'list'] as const;

/**
 * SWR-backed portfolios hook. Wraps `portfolioApi.list()` with the
 * global SWRConfig (dedupe 2s, no focus revalidation, two retries).
 *
 * Returns the standard SWR `{ data, error, isLoading, mutate }` shape;
 * call sites can `mutate()` after a write to force refetch.
 */
export function usePortfolios() {
  return useSWR(key, () => portfolioApi.list());
}

usePortfolios.key = key;
