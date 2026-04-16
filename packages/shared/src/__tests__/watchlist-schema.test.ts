import { describe, expect, it } from 'vitest';
import { watchlistOverviewResponseSchema } from '../schemas/watchlist';

describe('watchlistOverviewResponseSchema', () => {
  it('accepts organized categories with items', () => {
    const result = watchlistOverviewResponseSchema.safeParse({
      categories: [
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          name: '电',
          key: '电',
          description: '电力与电网观察股',
          summary: '优先跟踪受益于 AI 用电和电网扩容的标的。',
          itemCount: 2,
          items: [
            {
              id: '660e8400-e29b-41d4-a716-446655440000',
              symbol: 'CEG',
              companyName: 'Constellation Energy',
              thesis: '核电资产稀缺。',
              notes: '回调时分批关注。',
              priority: 90,
              createdAt: '2026-04-16T12:00:00.000Z',
              updatedAt: '2026-04-16T12:00:00.000Z',
            },
          ],
          createdAt: '2026-04-16T12:00:00.000Z',
          updatedAt: '2026-04-16T12:00:00.000Z',
        },
      ],
    });

    expect(result.success).toBe(true);
  });
});
