import { tool } from 'ai';
import { z } from 'zod';

// TODO: wire when service exists
interface QuantAnalysisServiceStub {
  analyzeReturns(barsJson: string): Promise<string>;
  calculateVaR(barsJson: string, method: string): Promise<string>;
  analyzeVolatility(barsJson: string): Promise<string>;
  calculateCorrelation(barsJsonA: string, barsJsonB: string): Promise<string>;
}

/**
 * Quantitative risk analytics tools — return distributions, VaR, volatility,
 * and cross-asset correlation.
 *
 * Quant-analysis tool surface exposed to the agent.
 */
export function createQuantAnalysisTools(service: QuantAnalysisServiceStub) {
  return {
    analyzeReturns: tool({
      description:
        'Analyze return statistics for a stock including annualized return, volatility, ' +
        'Sharpe ratio, max drawdown, skewness, and kurtosis. Use this to assess overall risk/return ' +
        'profile. Negative skewness means left-tail risk (crash risk). High kurtosis means fat tails ' +
        '(extreme moves more likely). Sharpe ratio < 1 = poor risk-adjusted return, > 2 = excellent. ' +
        'Input is JSON array of OHLCV bars from getHistoricalPrices.',
      inputSchema: z.object({
        barsJson: z
          .string()
          .describe(
            'JSON array of price bars [{o,h,l,c,v,t}, ...] from getHistoricalPrices',
          ),
      }),
      execute: async ({ barsJson }) => {
        try {
          return await service.analyzeReturns(barsJson);
        } catch (e) {
          return `Error analyzing returns: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    calculateVaR: tool({
      description:
        'Calculate Value at Risk (VaR) and Conditional VaR (Expected Shortfall) for a stock. ' +
        "VaR answers: 'What is the maximum expected daily loss at a given confidence level?' " +
        'For example, 95% VaR of -2% on a $100K position means you should not lose more than $2,000 ' +
        "in a single day 95% of the time. CVaR measures average loss in the worst cases beyond VaR. " +
        "Use 'historical' method for non-normal distributions or 'parametric' for normal assumption. " +
        'Input is JSON array of OHLCV bars from getHistoricalPrices.',
      inputSchema: z.object({
        barsJson: z
          .string()
          .describe(
            'JSON array of price bars [{o,h,l,c,v,t}, ...] from getHistoricalPrices',
          ),
        method: z
          .enum(['historical', 'parametric'])
          .describe(
            "VaR calculation method: 'historical' (empirical quantile) or 'parametric' (assumes normal distribution)",
          ),
      }),
      execute: async ({ barsJson, method }) => {
        try {
          return await service.calculateVaR(barsJson, method);
        } catch (e) {
          return `Error calculating VaR: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    analyzeVolatility: tool({
      description:
        'Analyze current volatility regime for a stock — is volatility low, normal, high, or extreme? ' +
        'Compares recent 20-day volatility against historical levels and identifies the regime. ' +
        'High volatility = wider stop-losses needed, position size should decrease. ' +
        'Low volatility often precedes breakouts. Includes rolling volatility trend. ' +
        'Input is JSON array of OHLCV bars from getHistoricalPrices.',
      inputSchema: z.object({
        barsJson: z
          .string()
          .describe(
            'JSON array of price bars [{o,h,l,c,v,t}, ...] from getHistoricalPrices',
          ),
      }),
      execute: async ({ barsJson }) => {
        try {
          return await service.analyzeVolatility(barsJson);
        } catch (e) {
          return `Error analyzing volatility: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    calculateCorrelation: tool({
      description:
        "Calculate the Pearson correlation between two stocks' returns. " +
        'Correlation > 0.7 = highly correlated (move together, less diversification benefit). ' +
        'Correlation 0.3-0.7 = moderately correlated. Correlation < 0.3 = low correlation ' +
        '(good for diversification). Negative correlation = inverse relationship (natural hedge). ' +
        'Both inputs must cover the same time period with the same number of bars.',
      inputSchema: z.object({
        barsJsonA: z
          .string()
          .describe(
            'JSON array of price bars for first stock [{o,h,l,c,v,t}, ...]',
          ),
        barsJsonB: z
          .string()
          .describe(
            'JSON array of price bars for second stock [{o,h,l,c,v,t}, ...]',
          ),
      }),
      execute: async ({ barsJsonA, barsJsonB }) => {
        try {
          return await service.calculateCorrelation(barsJsonA, barsJsonB);
        } catch (e) {
          return `Error calculating correlation: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),
  };
}
