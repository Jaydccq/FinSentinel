import { registerAs } from '@nestjs/config';

export const mcpConfig = registerAs('mcp', () => ({
  serverEnabled: process.env['MCP_SERVER_ENABLED'] === 'true',
  apiKey: process.env['MCP_API_KEY'],
  userId: process.env['MCP_USER_ID'],
}));
