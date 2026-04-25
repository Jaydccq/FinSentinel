import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';
import { usePortfolios } from '../use-portfolios';
import { usePortfolio } from '../use-portfolio';
import { portfolioApi } from '../../../api/portfolio';

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    {children}
  </SWRConfig>
);

describe('usePortfolios', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns data after fetch resolves', async () => {
    const spy = vi
      .spyOn(portfolioApi, 'list')
      .mockResolvedValueOnce([{ id: 'p1', name: 'main' } as never]);
    const { result } = renderHook(() => usePortfolios(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.[0]?.id).toBe('p1');
    expect(spy).toHaveBeenCalledOnce();
  });

  it('dedupes concurrent renders to a single API call', async () => {
    // Mount two `usePortfolios()` calls in the SAME render tree so they
    // share SWR's per-tree cache; with a non-zero dedupingInterval, the
    // second call hits the in-flight request instead of re-fetching.
    const dedupeWrapper = ({ children }: { children: ReactNode }) => (
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 2000 }}>
        {children}
      </SWRConfig>
    );
    const spy = vi
      .spyOn(portfolioApi, 'list')
      .mockResolvedValue([{ id: 'p1' } as never]);
    const { result } = renderHook(
      () => ({ a: usePortfolios(), b: usePortfolios() }),
      { wrapper: dedupeWrapper },
    );
    await waitFor(() => expect(result.current.a.data).toBeDefined());
    await waitFor(() => expect(result.current.b.data).toBeDefined());
    expect(spy).toHaveBeenCalledOnce();
  });

  it('exposes error from fetcher', async () => {
    vi.spyOn(portfolioApi, 'list').mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => usePortfolios(), { wrapper });
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect((result.current.error as Error).message).toBe('boom');
  });
});

describe('usePortfolio', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('skips fetch when id is undefined', async () => {
    const spy = vi.spyOn(portfolioApi, 'get');
    const { result } = renderHook(() => usePortfolio(undefined), { wrapper });
    // SWR returns isLoading=false when key is null
    expect(result.current.data).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it('fetches when id is provided', async () => {
    const spy = vi
      .spyOn(portfolioApi, 'get')
      .mockResolvedValueOnce({ id: 'p1', name: 'main', holdings: [] } as never);
    const { result } = renderHook(() => usePortfolio('p1'), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.id).toBe('p1');
    expect(spy).toHaveBeenCalledWith('p1');
  });
});
