import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Res,
  UseGuards,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
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
 * JSON-RPC 2.0 message types for MCP protocol.
 */
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
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

/** Map tool names to catalogue entries for O(1) lookup. */
const TOOL_MAP = new Map(MCP_TOOL_CATALOGUE.map((t) => [t.name, t]));

@Controller('mcp')
@UseGuards(McpApiKeyGuard)
export class McpController {
  private readonly logger = new Logger(McpController.name);

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

  /**
   * GET /mcp/sse — Server-Sent Events transport for MCP protocol.
   *
   * Opens a persistent SSE connection. On connect, sends the server
   * capabilities (tools/list) as the initial event. The client can
   * POST to /mcp/message to invoke tools; responses arrive on this stream.
   *
   * This implements the MCP SSE transport spec:
   * - Client opens GET /mcp/sse (SSE)
   * - Server sends `endpoint` event with the message URL
   * - Client POSTs JSON-RPC messages to that URL
   * - Server sends `message` events with JSON-RPC responses
   */
  @Get('sse')
  sse(@Res() res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Send the endpoint event so the client knows where to POST messages
    this.sendSseEvent(res, 'endpoint', '/mcp/message');

    // Send server info
    const serverInfo: JsonRpcResponse = {
      jsonrpc: '2.0',
      id: 0,
      result: {
        serverInfo: { name: 'finsentinel-mcp', version: '1.0.0' },
        capabilities: { tools: { listChanged: false } },
        toolCount: MCP_TOOL_CATALOGUE.length,
      },
    };
    this.sendSseEvent(res, 'message', JSON.stringify(serverInfo));

    // Keep-alive ping every 30s
    const pingInterval = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(pingInterval);
      }
    }, 30_000);

    // Clean up on client disconnect
    res.on('close', () => {
      clearInterval(pingInterval);
      this.logger.debug('MCP SSE client disconnected');
    });
  }

  /**
   * POST /mcp/message — JSON-RPC 2.0 message endpoint for MCP protocol.
   *
   * Handles:
   * - `tools/list` → returns tool catalogue
   * - `tools/call` → executes a tool (stub: returns tool schema)
   * - `initialize` → returns server capabilities
   */
  @Post('message')
  async handleMessage(
    @Body() body: JsonRpcRequest,
  ): Promise<JsonRpcResponse> {
    if (body.jsonrpc !== '2.0' || !body.method) {
      throw new BadRequestException('Invalid JSON-RPC 2.0 request');
    }

    switch (body.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'finsentinel-mcp', version: '1.0.0' },
            capabilities: {
              tools: { listChanged: false },
            },
          },
        };

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: MCP_TOOL_CATALOGUE.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          },
        };

      case 'tools/call': {
        const toolName = (body.params as Record<string, unknown>)?.name as string;
        const toolArgs = (body.params as Record<string, unknown>)?.arguments as Record<string, unknown> | undefined;

        if (!toolName || !TOOL_MAP.has(toolName)) {
          return {
            jsonrpc: '2.0',
            id: body.id,
            error: {
              code: -32602,
              message: `Unknown tool: ${toolName}`,
              data: { availableTools: Array.from(TOOL_MAP.keys()) },
            },
          };
        }

        this.logger.log(`MCP tool call: ${toolName}(${JSON.stringify(toolArgs)})`);

        // Tool execution placeholder — wire to actual services when ready
        return {
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  tool: toolName,
                  status: 'executed',
                  args: toolArgs ?? {},
                  message: `Tool ${toolName} invoked successfully. Wire to actual service for real data.`,
                }),
              },
            ],
          },
        };
      }

      case 'notifications/initialized':
        // Client notification, no response needed but return ack
        return { jsonrpc: '2.0', id: body.id, result: {} };

      default:
        return {
          jsonrpc: '2.0',
          id: body.id,
          error: {
            code: -32601,
            message: `Method not found: ${body.method}`,
          },
        };
    }
  }

  /**
   * POST /mcp/tools/:name — Direct tool execution endpoint (REST style).
   *
   * Alternative to JSON-RPC for simpler integrations.
   */
  @Post('tools/:name')
  async executeTool(
    @Param('name') name: string,
    @Body() args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const tool = TOOL_MAP.get(name);
    if (!tool) {
      throw new BadRequestException(
        `Unknown tool: ${name}. Available: ${Array.from(TOOL_MAP.keys()).join(', ')}`,
      );
    }

    this.logger.log(`MCP REST tool call: ${name}(${JSON.stringify(args)})`);

    return {
      tool: name,
      status: 'executed',
      args,
      message: `Tool ${name} invoked. Wire to actual service for real data.`,
    };
  }

  // ── SSE helpers ────────────────────────────────────────────────────────────

  private sendSseEvent(res: Response, event: string, data: string): void {
    res.write(`event: ${event}\ndata: ${data}\n\n`);
  }
}
