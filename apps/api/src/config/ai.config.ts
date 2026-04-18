import { registerAs } from '@nestjs/config';

export const aiConfig = registerAs('ai', () => ({
  openrouterApiKey: process.env['OPENROUTER_API_KEY']!,
  openrouterBaseUrl: process.env['OPENROUTER_BASE_URL'] || 'https://openrouter.ai/api/v1',
  model: process.env['AI_MODEL'] || 'google/gemini-3-flash-preview',
  embeddingModel: process.env['AI_EMBEDDING_MODEL'] || 'text-embedding-3-small',
}));
