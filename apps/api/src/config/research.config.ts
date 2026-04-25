import { registerAs } from '@nestjs/config';

export const researchConfig = registerAs('research', () => ({
  defaultProvider: process.env['RESEARCH_DEFAULT_PROVIDER'] || 'polygon',
}));
