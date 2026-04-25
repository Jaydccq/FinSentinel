import { registerAs } from '@nestjs/config';

export const firecrawlConfig = registerAs('firecrawl', () => ({
  apiKey: process.env['FIRECRAWL_API_KEY'],
  baseUrl: process.env['FIRECRAWL_BASE_URL'] || 'https://api.firecrawl.dev/v2',
}));
