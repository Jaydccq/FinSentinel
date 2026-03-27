import { registerAs } from '@nestjs/config';

export const personaConfig = registerAs('persona', () => ({
  active: (process.env['APP_AGENT_PERSONA'] || 'default') as
    | 'default'
    | 'conservative'
    | 'aggressive',
}));
