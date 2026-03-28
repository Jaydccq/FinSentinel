import { tool } from 'ai';
import { z } from 'zod';

// TODO: wire when service exists
interface CompanyResearchServiceStub {
  getCompanyProfile(ticker: string): Promise<string>;
  getFinancialStatements(ticker: string, periods: number): Promise<string>;
  getAnalystRating(ticker: string): Promise<string>;
}

/**
 * Company fundamental research tools — profiles, financials, analyst ratings.
 *
 * Maps to Java CompanyResearchTool (3 methods).
 */
export function createCompanyResearchTools(
  service: CompanyResearchServiceStub,
) {
  return {
    getCompanyProfile: tool({
      description:
        'Get company profile and overview for a stock ticker. ' +
        'Returns company name, sector, industry, market cap, description, employee count, ' +
        'IPO date, exchange, and homepage URL. ' +
        "Use this when the user asks 'tell me about AAPL', 'what does MSFT do?', " +
        "'company overview for TSLA', or any request for basic company information.",
      inputSchema: z.object({
        ticker: z
          .string()
          .describe('Stock ticker symbol, e.g. AAPL, MSFT, TSLA'),
      }),
      execute: async ({ ticker }) => {
        try {
          return await service.getCompanyProfile(ticker);
        } catch (e) {
          return `Error fetching company profile for ${ticker}: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    getFinancialStatements: tool({
      description:
        'Get financial statements and key metrics for a stock ticker. ' +
        'Returns revenue, net income, EPS, margins (gross/operating/net), ' +
        'balance sheet health (assets, liabilities, equity, current ratio, debt-to-equity), ' +
        'valuation ratios (PE, PB), revenue growth, and cash flow data. ' +
        'Data comes from SEC filings via Polygon.io. ' +
        'Use this when the user asks about financial performance, earnings, profitability, ' +
        'balance sheet strength, or financial trends for a company.',
      inputSchema: z.object({
        ticker: z.string().describe('Stock ticker symbol, e.g. AAPL, MSFT'),
        periods: z
          .number()
          .int()
          .min(1)
          .max(10)
          .describe('Number of fiscal periods to retrieve (1-10, default 4)'),
      }),
      execute: async ({ ticker, periods }) => {
        try {
          return await service.getFinancialStatements(ticker, periods);
        } catch (e) {
          return `Error fetching financial data for ${ticker}: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    getAnalystRating: tool({
      description:
        'Get analyst rating and price target estimates for a stock ticker. ' +
        'Returns recommendation (STRONG_BUY/BUY/HOLD/SELL/STRONG_SELL), target price range ' +
        '(high/low/median), current price, and upside potential percentage. ' +
        'IMPORTANT: These are computed estimates based on financial metrics (PE ratio, revenue growth, ' +
        'net margin), NOT real analyst consensus data. Always communicate this to the user. ' +
        'Use this when the user asks about analyst opinions, price targets, or buy/sell recommendations.',
      inputSchema: z.object({
        ticker: z.string().describe('Stock ticker symbol, e.g. AAPL, MSFT'),
      }),
      execute: async ({ ticker }) => {
        try {
          return await service.getAnalystRating(ticker);
        } catch (e) {
          return `Error computing analyst rating for ${ticker}: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),
  };
}
