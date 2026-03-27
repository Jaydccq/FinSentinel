import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { envSchema } from './env.validation';
import { databaseConfig } from './database.config';
import { redisConfig } from './redis.config';
import { jwtConfig } from './jwt.config';
import { aiConfig } from './ai.config';
import { polygonConfig } from './polygon.config';
import { tradingConfig } from './trading.config';
import { personaConfig } from './persona.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config: Record<string, unknown>) => envSchema.parse(config),
      load: [
        databaseConfig,
        redisConfig,
        jwtConfig,
        aiConfig,
        polygonConfig,
        tradingConfig,
        personaConfig,
      ],
    }),
  ],
})
export class AppConfigModule {}
