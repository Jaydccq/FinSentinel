import { registerAs } from '@nestjs/config';

export const jwtConfig = registerAs('jwt', () => ({
  secret: process.env['JWT_SECRET']!,
  expiration: Number(process.env['JWT_EXPIRATION']) || 86400000,
  issuer: process.env['JWT_ISSUER'] || 'finsentinel-api',
  audience: process.env['JWT_AUDIENCE'] || 'finsentinel-web',
}));
