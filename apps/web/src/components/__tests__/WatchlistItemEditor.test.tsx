/**
 * Smoke test for the SWR-migrated WatchlistItemEditor. Verifies:
 *   1. The editor populates fields from the overview SWR response.
 *   2. Save calls `watchlistApi.updateItem` and triggers list revalidation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { watchlistApi } = await import('../../api/watchlist');
const WatchlistItemEditor = (await import('../WatchlistItemEditor')).default;

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    {children}
  </SWRConfig>
);

const overview = {
  categories: [
    {
      id: 'c1',
      name: 'Dashboard',
      items: [
        {
          id: 'i1',
          symbol: 'AAPL',
          thesis: 'mega cap',
          notes: 'watch earnings',
          priority: 5,
        },
      ],
    },
  ],
};

describe('WatchlistItemEditor (SWR-backed)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('loads the matching item from the overview and saves through updateItem', async () => {
    const listSpy = vi
      .spyOn(watchlistApi, 'list')
      .mockResolvedValue(overview as never);
    const updateSpy = vi
      .spyOn(watchlistApi, 'updateItem')
      .mockResolvedValueOnce({ id: 'i1', symbol: 'AAPL' } as never);

    const onClose = vi.fn();
    render(
      <WatchlistItemEditor symbol="AAPL" categoryName="Dashboard" onClose={onClose} />,
      { wrapper },
    );

    await waitFor(() =>
      expect(screen.getByDisplayValue('mega cap')).toBeDefined(),
    );

    const submit = screen.getByRole('button', { name: /save/i });
    await act(async () => {
      fireEvent.click(submit);
    });

    await waitFor(() => expect(updateSpy).toHaveBeenCalledOnce());
    expect(updateSpy).toHaveBeenCalledWith('i1', expect.objectContaining({ thesis: 'mega cap' }));
    // updateItem triggers a swr.mutate() which calls list a second time.
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(2));
  });
});
