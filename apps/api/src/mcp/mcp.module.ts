import { Module } from '@nestjs/common';
import { McpController } from './mcp.controller';
import { McpApiKeyGuard } from './mcp-api-key.guard';

/**
 * MCP Server module — conditionally loaded when MCP_SERVER_ENABLED=true.
 *
 * Exposes stateless market-data tools via REST endpoints guarded by API key auth.
 * The full MCP SSE transport can be layered on later via `@modelcontextprotocol/sdk`.
 *
 * Excluded tools (require user context):
 *   TradingTool, BrainTool, UserProfileTool, AutonomyTool,
 *   PortfolioAnalysisTool, ThinkingTool, ConfirmationTool
 */
@Module({
  controllers: [McpController],
  providers: [McpApiKeyGuard],
})
export class McpModule {}
