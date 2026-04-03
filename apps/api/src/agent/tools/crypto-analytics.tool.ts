import { tool } from 'ai';
import { z } from 'zod';

// TODO: wire when service exists
interface CryptoAnalyticsServiceStub {
  getFundingRate(instId: string): Promise<string>;
  analyzePosition(instId: string): Promise<string>;
  setLeverage(instId: string, leverage: number, marginMode: string): Promise<string>;
}

/**
 * OKX-specific crypto analytics tools — funding rates, position analysis,
 * and leverage management.
 *
 * Gated by APP_OKX_ENABLED=true.
 *
 * Crypto-analytics tool surface exposed to the agent.
 */
export function createCryptoAnalyticsTools(
  service: CryptoAnalyticsServiceStub,
) {
  return {
    getFundingRate: tool({
      description:
        'Get the current and next funding rate for a crypto perpetual contract. ' +
        'Shows annualized cost/income of holding the position. ' +
        'Use this to assess carry cost before opening or keeping a perpetual position. ' +
        'Example instrument: BTC-USDT-SWAP, ETH-USDT-SWAP.',
      inputSchema: z.object({
        instId: z
          .string()
          .describe(
            "Perpetual swap instrument ID, e.g. 'BTC-USDT-SWAP'",
          ),
      }),
      execute: async ({ instId }) => {
        try {
          return await service.getFundingRate(instId.toUpperCase().trim());
        } catch (e) {
          return `Error fetching funding rate: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    analyzePosition: tool({
      description:
        'Comprehensive analysis of a crypto perpetual position: ' +
        'combines position data, funding rate, and live ticker into a single view. ' +
        'Calculates liquidation distance percentage and warns if < 5%. ' +
        'Use this to quickly assess a position before making trading recommendations.',
      inputSchema: z.object({
        instId: z
          .string()
          .describe(
            "Instrument ID to analyze, e.g. 'BTC-USDT-SWAP'",
          ),
      }),
      execute: async ({ instId }) => {
        try {
          return await service.analyzePosition(instId.toUpperCase().trim());
        } catch (e) {
          return `Error analyzing position: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    setLeverage: tool({
      description:
        'Set leverage for a crypto instrument. ' +
        "Valid range: 1-125. Margin modes: 'cross' (shared margin) or 'isolated' (per-position). " +
        'CRITICAL: This is a LIVE money mutation that changes liquidation prices and margin requirements. ' +
        'You MUST call getConfirm BEFORE calling this tool. Do NOT set leverage without explicit user approval.',
      inputSchema: z.object({
        instId: z
          .string()
          .describe("Instrument ID, e.g. 'BTC-USDT-SWAP'"),
        leverage: z
          .number()
          .int()
          .min(1)
          .max(125)
          .describe('Leverage multiplier, e.g. 5 for 5x'),
        marginMode: z
          .enum(['cross', 'isolated'])
          .describe("Margin mode: 'cross' or 'isolated'"),
      }),
      execute: async ({ instId, leverage, marginMode }) => {
        try {
          return await service.setLeverage(
            instId.toUpperCase().trim(),
            leverage,
            marginMode,
          );
        } catch (e) {
          return `Error setting leverage: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),
  };
}
