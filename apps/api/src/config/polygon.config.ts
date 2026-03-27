import { registerAs } from '@nestjs/config';

export const polygonConfig = registerAs('polygon', () => ({
  apiKey: process.env['POLYGON_API_KEY']!,
}));
