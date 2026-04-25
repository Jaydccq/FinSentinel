'use client';

import useSWR from 'swr';
import { portfolioApi } from '../../api/portfolio';

/**
 * SWR-backed single-portfolio hook keyed by id. Passing `undefined`
 * disables the fetch (idiomatic SWR conditional fetching).
 *
 * `data?.holdings` exposes the holdings list — there is no separate
 * `positions` endpoint on the API; holdings are nested in the portfolio
 * response.
 */
export function usePortfolio(id: string | undefined) {
  return useSWR(
    id ? (['portfolios', 'detail', id] as const) : null,
    () => portfolioApi.get(id!),
  );
}
