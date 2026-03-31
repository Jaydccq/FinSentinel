import { registerAs } from '@nestjs/config';

export const encryptionConfig = registerAs('encryption', () => ({
  aesKey: process.env['ENCRYPTION_AES_KEY'],
}));
