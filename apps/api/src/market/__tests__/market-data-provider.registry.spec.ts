import { describe, it, expect, vi } from 'vitest';
import { MarketDataProviderRegistry } from '../market-data-provider.registry';
import type { MarketDataProvider } from '../interfaces/market-data-provider';

function makeProvider(name: string, withSearch = false): MarketDataProvider {
  const base: MarketDataProvider = {
    getName: () => name,
    getQuote: vi.fn(),
    getHistoricalBars: vi.fn(),
    supports: () => true,
  };
  if (withSearch) {
    base.searchTickers = vi.fn().mockResolvedValue([]);
  }
  return base;
}

const fakePolygonConfig = { apiKey: '' } as never;

describe('MarketDataProviderRegistry.getSearchProvider', () => {
  it('returns the default provider when it implements searchTickers', () => {
    const polygonWithSearch = makeProvider('polygon', true);
    const yahoo = makeProvider('yahoo', true);
    const reg = new MarketDataProviderRegistry([polygonWithSearch, yahoo], fakePolygonConfig);
    expect(reg.getSearchProvider().getName()).toBe('polygon');
  });

  it('falls back to Yahoo when the default does not implement searchTickers', () => {
    const polygon = makeProvider('polygon', false);
    const yahoo = makeProvider('yahoo', true);
    const reg = new MarketDataProviderRegistry([polygon, yahoo], fakePolygonConfig);
    expect(reg.getSearchProvider().getName()).toBe('yahoo');
  });

  it('throws a descriptive error when no provider implements searchTickers', () => {
    const polygon = makeProvider('polygon', false);
    const yahoo = makeProvider('yahoo', false);
    const reg = new MarketDataProviderRegistry([polygon, yahoo], fakePolygonConfig);
    expect(() => reg.getSearchProvider()).toThrow(/No search-capable/i);
  });
});
