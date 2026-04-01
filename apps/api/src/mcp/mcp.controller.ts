import { Controller, Get, UseGuards } from '@nestjs/common';
import { McpApiKeyGuard } from './mcp-api-key.guard';

/**
 * Stateless MCP tool catalogue for a given tool set.
 * Each entry has the tool name, description, and input schema.
 */
interface McpToolEntry {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Stateless tool definitions exposed to MCP clients (e.g. Claude Desktop).
 *
 * 10 stateless tools from the agent's tool registry are listed.
 * User-scoped tools (trading, brain, autonomy, etc.) are excluded because
 * MCP operates with a synthetic service account, not a real user session.
 *
 * The full MCP protocol transport (SSE + JSON-RPC) can be layered on via
 * `@modelcontextprotocol/sdk` — this controller provides a simple REST
 * listing endpoint for initial integration.
 */
const MCP_TOOL_CATALOGUE: McpToolEntry[] = [
  // Group A — fully wired
  {
    name: 'getStockQuote',
    description:
      'Get real-time stock market data for a given ticker symbol. Returns current price, open, high, low, close, and volume.',
    inputSchema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Stock ticker symbol, e.g. AAPL, MSFT, TSLA' },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'getHistoricalPrices',
    description:
      'Get historical stock price data (daily bars) for technical analysis. Returns OHLCV bars for the specified number of days.',
    inputSchema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Stock ticker symbol' },
        days: { type: 'number', description: 'Number of days of historical data (max 365)' },
      },
      required: ['ticker', 'days'],
    },
  },
  {
    name: 'calculateTechnicalIndicators',
    description:
      'Calculate technical indicators (RSI, MACD, Bollinger Bands, SMA, EMA) for a stock. Uses Ta4j-equivalent calculations.',
    inputSchema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Stock ticker symbol' },
        indicators: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of indicators to calculate: RSI, MACD, BOLLINGER, SMA, EMA',
        },
        days: { type: 'number', description: 'Number of days of data to use (default 90)' },
      },
      required: ['ticker', 'indicators'],
    },
  },

  // Group B — stateless service-backed (stubs until services exist)
  {
    name: 'getRecentNews',
    description:
      'Fetch recent financial news articles for a stock ticker from Polygon.io.',
    inputSchema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Stock ticker symbol' },
        days: { type: 'number', description: 'Number of days back to search (1-30)' },
      },
      required: ['ticker', 'days'],
    },
  },
  {
    name: 'searchKnowledgeBase',
    description:
      'Search the RAG knowledge base for relevant financial documents (SEC filings, research reports, news).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        docType: { type: 'string', description: 'Document type filter (optional)' },
        afterDate: { type: 'string', description: 'Date filter in YYYY-MM-DD (optional)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'analyzeReturns',
    description:
      'Analyze return statistics including annualized return, volatility, Sharpe ratio, max drawdown, skewness, and kurtosis.',
    inputSchema: {
      type: 'object',
      properties: {
        barsJson: { type: 'string', description: 'JSON array of OHLCV bars' },
      },
      required: ['barsJson'],
    },
  },
  {
    name: 'getCompanyProfile',
    description:
      'Get company profile information including sector, industry, market cap, and description.',
    inputSchema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Stock ticker symbol' },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'screenEquities',
    description:
      'Screen equities by market cap, sector, P/E ratio, dividend yield, and other fundamental criteria.',
    inputSchema: {
      type: 'object',
      properties: {
        sector: { type: 'string', description: 'Sector filter (optional)' },
        minMarketCap: { type: 'number', description: 'Minimum market cap in USD (optional)' },
        maxPeRatio: { type: 'number', description: 'Maximum P/E ratio (optional)' },
      },
      required: [],
    },
  },
  {
    name: 'getMarketCalendar',
    description:
      'Get upcoming market events: earnings, IPOs, economic calendar, and dividends.',
    inputSchema: {
      type: 'object',
      properties: {
        eventType: { type: 'string', description: 'Event type: EARNINGS, IPO, ECONOMIC, DIVIDEND' },
        days: { type: 'number', description: 'Number of days to look ahead (default 7)' },
      },
      required: ['eventType'],
    },
  },
  {
    name: 'getInstitutionalOwnership',
    description:
      'Get institutional ownership data including top holders, ownership changes, and insider transactions.',
    inputSchema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Stock ticker symbol' },
      },
      required: ['ticker'],
    },
  },
];

@Controller('mcp')
@UseGuards(McpApiKeyGuard)
export class McpController {
  /**
   * GET /mcp/tools — returns the catalogue of stateless tools available
   * for MCP clients.
   *
   * This mirrors the Java McpToolConfig which registers 10 stateless tool
   * classes (32 methods) via MethodToolCallbackProvider.
   */
  @Get('tools')
  listTools(): { tools: McpToolEntry[] } {
    return { tools: MCP_TOOL_CATALOGUE };
  }

  /**
   * GET /mcp/health — lightweight health check for MCP connectivity.
   * Requires valid API key (guard applies at controller level).
   */
  @Get('health')
  health(): { status: string; toolCount: number } {
    return { status: 'ok', toolCount: MCP_TOOL_CATALOGUE.length };
  }
}
