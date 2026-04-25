import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';
import { useWatchlist } from '../use-watchlist';
import { watchlistApi } from '../../../api/watchlist';

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    {children}
  </SWRConfig>
);

describe('useWatchlist', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns overview data', async () => {
    const spy = vi
      .spyOn(watchlistApi, 'list')
      .mockResolvedValueOnce({ categories: [] } as never);
    const { result } = renderHook(() => useWatchlist(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.categories).toEqual([]);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('refetches after a write via save()', async () => {
    const listSpy = vi
      .spyOn(watchlistApi, 'list')
      .mockResolvedValueOnce({ categories: [] } as never)
      .mockResolvedValueOnce({
        categories: [{ id: 'cat1', name: 'Dashboard', items: [{ id: '1' }] }],
      } as never);
    const saveSpy = vi
      .spyOn(watchlistApi, 'save')
      .mockResolvedValueOnce({ id: 'cat1' } as never);

    const { result } = renderHook(() => useWatchlist(), { wrapper });
    await waitFor(() => expect(result.current.data?.categories).toEqual([]));

    await act(async () => {
      await result.current.save({
        categoryName: 'Dashboard',
        items: [{ symbol: 'AAPL' }],
      } as never);
    });

    await waitFor(() => expect(result.current.data?.categories).toHaveLength(1));
    expect(saveSpy).toHaveBeenCalledOnce();
    expect(listSpy).toHaveBeenCalledTimes(2);
  });

  it('refetches after deleteItem()', async () => {
    const listSpy = vi
      .spyOn(watchlistApi, 'list')
      .mockResolvedValueOnce({
        categories: [{ id: 'c', name: 'X', items: [{ id: 'i1' }] }],
      } as never)
      .mockResolvedValueOnce({ categories: [] } as never);
    vi.spyOn(watchlistApi, 'deleteItem').mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useWatchlist(), { wrapper });
    await waitFor(() => expect(result.current.data?.categories).toHaveLength(1));

    await act(async () => {
      await result.current.deleteItem('i1');
    });

    await waitFor(() => expect(result.current.data?.categories).toEqual([]));
    expect(listSpy).toHaveBeenCalledTimes(2);
  });

  it('exposes error from fetcher', async () => {
    vi.spyOn(watchlistApi, 'list').mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useWatchlist(), { wrapper });
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect((result.current.error as Error).message).toBe('boom');
  });
});
