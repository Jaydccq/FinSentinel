import { tool } from 'ai';
import { z } from 'zod';

// TODO: wire when service exists
interface UnifiedTradingServiceStub {
  stage(userId: string, action: string, symbol: string, qty?: string, amount?: string, price?: string): Promise<string>;
  commit(userId: string, message: string): Promise<string>;
  execute(userId: string): Promise<string>;
  getWalletStatus(userId: string): Promise<string>;
  getPositions(userId: string): Promise<string>;
  getCommitLog(userId: string, limit: number): Promise<string>;
  getStagedOrders(userId: string): Promise<string>;
  searchAssets(userId: string, query: string): Promise<string>;
  checkMarketHours(userId: string): Promise<string>;
  syncOrders(userId: string): Promise<string>;
  switchMode(userId: string, mode: string): Promise<string>;
}

/**
 * Unified trading tools — stage/commit/execute lifecycle, portfolio queries,
 * asset search, market hours, order sync, and mode switching.
 *
 * userId is injected via closure (factory param), NOT as a tool parameter.
 *
 * Unified trading tool surface exposed to the agent.
 */
export function createUnifiedTradingTools(
  service: UnifiedTradingServiceStub,
  userId: string,
) {
  return {
    stageOrder: tool({
      description:
        'Stage a trade order for any asset. The symbol can be a stock ticker (AAPL), ' +
        'crypto perpetual (BTC-USDT-SWAP), or crypto spot pair (BTC/USD). The system automatically ' +
        'routes to the correct broker. Action must be BUY, SELL, or CLOSE. Specify either qty ' +
        '(number of shares/contracts) or amount (dollar amount). Price is optional — null means market order.',
      inputSchema: z.object({
        action: z.enum(['BUY', 'SELL', 'CLOSE']).describe('Trade action: BUY, SELL, or CLOSE'),
        symbol: z.string().describe('Asset symbol, e.g. AAPL, BTC-USDT-SWAP, BTC/USD'),
        qty: z.string().optional().describe('Number of shares/contracts, or omit if specifying amount'),
        amount: z.string().optional().describe('Dollar amount, or omit if specifying qty'),
        price: z.string().optional().describe('Limit price, or omit for market order'),
      }),
      execute: async ({ action, symbol, qty, amount, price }) => {
        try {
          return await service.stage(userId, action, symbol, qty, amount, price);
        } catch (e) {
          return `Error staging order: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    commitTrade: tool({
      description:
        'Commit all staged orders with a rationale message. This creates an immutable ' +
        'commit with SHA-256 hash. Must be called after staging and before executing.',
      inputSchema: z.object({
        message: z
          .string()
          .describe(
            "Commit message explaining the trading rationale, " +
              "e.g. 'Going long BTC based on bullish breakout and strong funding rate'",
          ),
      }),
      execute: async ({ message }) => {
        try {
          return await service.commit(userId, message);
        } catch (e) {
          return `Error committing trade: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    executeTrade: tool({
      description:
        'Execute the last committed trade. Each staged order is routed to the ' +
        'appropriate broker automatically. Paper mode simulates; live mode hits the real broker.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          return await service.execute(userId);
        } catch (e) {
          return `Error executing trade: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    getWalletStatus: tool({
      description:
        'Get unified portfolio status across all connected brokers. Shows cash balance, ' +
        'positions with current prices and P/L, total portfolio value, and return percentage.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          return await service.getWalletStatus(userId);
        } catch (e) {
          return `Error fetching wallet status: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    getPositions: tool({
      description:
        'Get all current positions across all brokers. Shows symbol, quantity, ' +
        'entry price, current price, P/L for each position.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          return await service.getPositions(userId);
        } catch (e) {
          return `Error fetching positions: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    getTradeHistory: tool({
      description:
        'Get the commit log showing recent trade history. Each entry shows the ' +
        'commit hash, message, timestamp, and operations. Default limit: 10.',
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .describe('Number of recent commits to show (max 50)'),
      }),
      execute: async ({ limit }) => {
        try {
          return await service.getCommitLog(userId, limit);
        } catch (e) {
          return `Error fetching trade history: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    getStagedOrders: tool({
      description:
        'View all currently staged (uncommitted) orders. Shows the asset, action, ' +
        'quantity, and price for each staged order.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          return await service.getStagedOrders(userId);
        } catch (e) {
          return `Error fetching staged orders: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    searchTradableAssets: tool({
      description:
        'Search for tradable assets across all connected brokers. Use this to find ' +
        "and compare assets cross-market (e.g., search 'gold' to find GLD ETF, GC futures, " +
        'PAXG crypto). Returns a list of matching Contracts with their broker and security type.',
      inputSchema: z.object({
        query: z
          .string()
          .describe("Search query, e.g. 'gold', 'BTC', 'AAPL'"),
      }),
      execute: async ({ query }) => {
        try {
          return await service.searchAssets(userId, query);
        } catch (e) {
          return `Error searching assets: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    checkMarketHours: tool({
      description:
        'Check if markets are currently open. Returns open/close status and ' +
        'next open/close times for the primary broker.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          return await service.checkMarketHours(userId);
        } catch (e) {
          return `Error checking market hours: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    syncOrders: tool({
      description:
        'Sync wallet with broker order status. Polls the broker for latest ' +
        'order fills and status changes.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          return await service.syncOrders(userId);
        } catch (e) {
          return `Error syncing orders: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    switchTradingMode: tool({
      description:
        'Switch between PAPER (simulated) and LIVE (real broker) trading mode. ' +
        'WARNING: LIVE mode executes real trades with real money.',
      inputSchema: z.object({
        mode: z
          .enum(['PAPER', 'LIVE'])
          .describe('Trading mode: PAPER or LIVE'),
      }),
      execute: async ({ mode }) => {
        try {
          return await service.switchMode(userId, mode);
        } catch (e) {
          return `Error switching mode: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),
  };
}
