import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockApiFetch = vi.fn()

vi.mock('../client', () => ({
  apiFetch: mockApiFetch,
}))

const { researchApi } = await import('../research')

describe('researchApi', () => {
  beforeEach(() => {
    mockApiFetch.mockReset()
  })

  it('normalizes string-based company profile numerics into numbers', async () => {
    mockApiFetch.mockResolvedValueOnce({
      ticker: 'AAPL',
      name: 'Apple Inc.',
      description: 'Consumer electronics',
      sector: 'Technology',
      industry: 'Consumer Electronics',
      homepageUrl: 'https://apple.com',
      marketCap: '3210000000000.00',
      employeeCount: 161000,
      listDate: '1980-12-12',
      exchange: 'NASDAQ',
    })

    const result = await researchApi.profile('AAPL')

    expect(result.marketCap).toBe(3210000000000)
    expect(result.employeeCount).toBe(161000)
  })

  it('normalizes string-based financial metrics into numbers', async () => {
    mockApiFetch.mockResolvedValueOnce([
      {
        ticker: 'AAPL',
        period: 'annual',
        fiscalPeriod: '2024',
        revenue: '391035000000.00',
        netIncome: '93736000000.00',
        eps: '6.11',
        grossMargin: '0.4620',
        operatingMargin: '0.3120',
        netMargin: '0.2397',
        peRatio: '29.45',
        pbRatio: '45.12',
        revenueGrowth: '0.0210',
        totalAssets: '352583000000.00',
        totalLiabilities: '290437000000.00',
        totalEquity: '62146000000.00',
        currentRatio: '1.0600',
        debtToEquity: '4.6700',
        operatingCashFlow: '118254000000.00',
        freeCashFlow: '99584000000.00',
        capitalExpenditure: '-18670000000.00',
      },
    ])

    const [result] = await researchApi.financials('AAPL', 1)

    expect(result).toEqual({
      ticker: 'AAPL',
      period: 'annual',
      fiscalPeriod: '2024',
      revenue: 391035000000,
      netIncome: 93736000000,
      eps: 6.11,
      grossMargin: 0.462,
      operatingMargin: 0.312,
      netMargin: 0.2397,
      peRatio: 29.45,
      pbRatio: 45.12,
      revenueGrowth: 0.021,
      totalAssets: 352583000000,
      totalLiabilities: 290437000000,
      totalEquity: 62146000000,
      currentRatio: 1.06,
      debtToEquity: 4.67,
      operatingCashFlow: 118254000000,
      freeCashFlow: 99584000000,
      capitalExpenditure: -18670000000,
    })
  })
})
