import {
  z,
  watchlistOverviewResponseSchema,
  watchlistCategoryResponseSchema,
  watchlistItemResponseSchema,
  saveWatchlistRequestSchema,
  updateWatchlistItemRequestSchema,
  updateWatchlistCategoryRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  authResponseSchema,
  portfolioRequestSchema,
  portfolioResponseSchema,
} from '@finsentinel/shared';

/**
 * RouteDescriptor pairs a `(path, method)` with its request and response
 * Zod schemas. The descriptors are consumed by `typedFetch` — the helper
 * spreads a descriptor and a `body` and gets full type inference back.
 */
export interface RouteDescriptor<
  TReq extends z.ZodTypeAny | undefined,
  TRes extends z.ZodTypeAny,
> {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  requestSchema: TReq;
  responseSchema: TRes;
}

function defineRoute<
  TReq extends z.ZodTypeAny | undefined,
  TRes extends z.ZodTypeAny,
>(d: RouteDescriptor<TReq, TRes>): RouteDescriptor<TReq, TRes> {
  return d;
}

/**
 * Phase 1 route registry — covers watchlist, auth, and portfolio. The
 * remaining 16 client modules continue to call `apiFetch` directly until
 * follow-up phases migrate them; tracked in
 * `docs/exec-plans/tech-debt-tracker.md`.
 */
export const routes = {
  watchlist: {
    list: defineRoute({
      path: '/watchlist',
      method: 'GET',
      requestSchema: undefined,
      responseSchema: watchlistOverviewResponseSchema,
    }),
    save: defineRoute({
      path: '/watchlist',
      method: 'POST',
      requestSchema: saveWatchlistRequestSchema,
      responseSchema: watchlistCategoryResponseSchema,
    }),
    updateItem: defineRoute({
      path: '/watchlist/items/:id',
      method: 'PATCH',
      requestSchema: updateWatchlistItemRequestSchema,
      responseSchema: watchlistItemResponseSchema,
    }),
    deleteItem: defineRoute({
      path: '/watchlist/items/:id',
      method: 'DELETE',
      requestSchema: undefined,
      responseSchema: z.undefined(),
    }),
    updateCategory: defineRoute({
      path: '/watchlist/categories/:id',
      method: 'PATCH',
      requestSchema: updateWatchlistCategoryRequestSchema,
      responseSchema: watchlistCategoryResponseSchema,
    }),
    deleteCategory: defineRoute({
      path: '/watchlist/categories/:id',
      method: 'DELETE',
      requestSchema: undefined,
      responseSchema: z.undefined(),
    }),
  },
  auth: {
    login: defineRoute({
      path: '/auth/login',
      method: 'POST',
      requestSchema: loginRequestSchema,
      responseSchema: authResponseSchema,
    }),
    register: defineRoute({
      path: '/auth/register',
      method: 'POST',
      requestSchema: registerRequestSchema,
      responseSchema: authResponseSchema,
    }),
    logout: defineRoute({
      path: '/auth/logout',
      method: 'POST',
      requestSchema: undefined,
      responseSchema: z.undefined(),
    }),
  },
  portfolio: {
    list: defineRoute({
      path: '/portfolios',
      method: 'GET',
      requestSchema: undefined,
      responseSchema: z.array(portfolioResponseSchema),
    }),
    get: defineRoute({
      path: '/portfolios/:id',
      method: 'GET',
      requestSchema: undefined,
      responseSchema: portfolioResponseSchema,
    }),
    create: defineRoute({
      path: '/portfolios',
      method: 'POST',
      requestSchema: portfolioRequestSchema,
      responseSchema: portfolioResponseSchema,
    }),
    update: defineRoute({
      path: '/portfolios/:id',
      method: 'PUT',
      requestSchema: portfolioRequestSchema,
      responseSchema: portfolioResponseSchema,
    }),
    delete: defineRoute({
      path: '/portfolios/:id',
      method: 'DELETE',
      requestSchema: undefined,
      responseSchema: z.undefined(),
    }),
  },
} as const;
