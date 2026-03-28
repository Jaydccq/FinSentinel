import { tool } from 'ai';
import { z } from 'zod';

// TODO: wire when service exists
interface PortfolioAnalysisServiceStub {
  analyzePortfolio(userId: string, portfolioId: string): Promise<string>;
}

/**
 * Portfolio analysis tool — sector concentration, top positions, P&L,
 * diversification risk metrics, and HHI.
 *
 * userId is injected via closure (factory param), NOT as a tool parameter.
 *
 * Maps to Java PortfolioAnalysisTool (1 method).
 */
export function createPortfolioAnalysisTools(
  service: PortfolioAnalysisServiceStub,
  userId: string,
) {
  return {
    analyzePortfolio: tool({
      description:
        "Analyze a user's portfolio holdings including sector concentration, " +
        'top positions by market value, unrealized P&L, and diversification risk metrics. ' +
        'Use this to assess concentration risk and portfolio composition.',
      inputSchema: z.object({
        portfolioId: z.string().describe('Portfolio UUID'),
      }),
      execute: async ({ portfolioId }) => {
        try {
          return await service.analyzePortfolio(userId, portfolioId);
        } catch (e) {
          return `Error analyzing portfolio: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),
  };
}
