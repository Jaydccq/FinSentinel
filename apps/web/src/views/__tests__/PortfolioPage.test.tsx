/**
 * Portfolio page smoke test — verifies the SWR-backed migration still
 * renders the first portfolio's name when `portfolioApi.list` resolves
 * with one entry. We mock the API surface and the recharts module
 * (it pulls in jsdom-incompatible measurement code).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PieChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pie: () => null,
  Cell: () => null,
  Tooltip: () => null,
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: () => (props: Record<string, unknown>) => {
        const { children, ...rest } = props as { children?: ReactNode };
        return <div {...rest}>{children}</div>;
      },
    },
  ),
}));

vi.mock('../../components/Skeleton', () => ({
  PortfolioListSkeleton: () => <div>Loading skeleton</div>,
}));

vi.mock('../../components/EmptyState', () => ({
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock('../../components/TickerSearchInput', () => ({
  default: () => null,
}));

vi.mock('../../components/Sparkline', () => ({
  default: () => null,
}));

vi.mock('../../api/market', () => ({
  marketApi: {
    batchQuotes: vi.fn().mockResolvedValue({}),
    history: vi.fn().mockResolvedValue([]),
  },
}));

const { portfolioApi } = await import('../../api/portfolio');
const PortfolioPage = (await import('../PortfolioPage')).default;

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    {children}
  </SWRConfig>
);

describe('PortfolioPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the first portfolio name after fetch', async () => {
    vi.spyOn(portfolioApi, 'list').mockResolvedValueOnce([
      {
        id: 'p1',
        name: 'Growth Fund',
        description: 'long term',
        totalValue: '1000.00',
        holdings: [],
        createdAt: '2026-04-25T00:00:00.000Z',
      } as never,
    ]);
    render(<PortfolioPage />, { wrapper });
    await waitFor(() => {
      expect(screen.getByText('Growth Fund')).toBeDefined();
    });
  });

  it('renders empty state when list resolves with no portfolios', async () => {
    vi.spyOn(portfolioApi, 'list').mockResolvedValueOnce([] as never);
    render(<PortfolioPage />, { wrapper });
    await waitFor(() => {
      expect(screen.getByText('No portfolios yet.')).toBeDefined();
    });
  });
});
