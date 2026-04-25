import { describe, expect, it } from 'vitest';
import { routes } from '../registry';
import {
  watchlistOverviewResponseSchema,
  saveWatchlistRequestSchema,
  authResponseSchema,
  loginRequestSchema,
  portfolioResponseSchema,
} from '@finsentinel/shared';

describe('routes registry', () => {
  it('exposes the watchlist list route bound to the overview schema', () => {
    expect(routes.watchlist.list.path).toBe('/watchlist');
    expect(routes.watchlist.list.method).toBe('GET');
    expect(routes.watchlist.list.responseSchema).toBe(watchlistOverviewResponseSchema);
  });

  it('exposes the watchlist save route with both request and response schemas', () => {
    expect(routes.watchlist.save.method).toBe('POST');
    expect(routes.watchlist.save.requestSchema).toBe(saveWatchlistRequestSchema);
  });

  it('exposes the auth login route with the auth response schema', () => {
    expect(routes.auth.login.path).toBe('/auth/login');
    expect(routes.auth.login.method).toBe('POST');
    expect(routes.auth.login.requestSchema).toBe(loginRequestSchema);
    expect(routes.auth.login.responseSchema).toBe(authResponseSchema);
  });

  it('exposes the portfolio get route bound to the portfolio response schema', () => {
    expect(routes.portfolio.get.path).toBe('/portfolios/:id');
    expect(routes.portfolio.get.method).toBe('GET');
    expect(routes.portfolio.get.responseSchema).toBe(portfolioResponseSchema);
  });
});
