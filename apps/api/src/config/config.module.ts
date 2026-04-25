import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'node:path';

import { envSchema } from './env.validation';
import { databaseConfig } from './database.config';
import { redisConfig } from './redis.config';
import { jwtConfig } from './jwt.config';
import { aiConfig } from './ai.config';
import { polygonConfig } from './polygon.config';
import { tradingConfig } from './trading.config';
import { personaConfig } from './persona.config';
import { storageConfig } from './storage.config';
import { okxConfig } from './okx.config';
import { alpacaConfig } from './alpaca.config';
import { openbbConfig } from './openbb.config';
import { fmpConfig } from './fmp.config';
import { ragConfig } from './rag.config';
import { archivalConfig } from './archival.config';
import { chatConfig } from './chat.config';
import { firecrawlConfig } from './firecrawl.config';
import { mcpConfig } from './mcp.config';
import { marketProviderConfig } from './market-provider.config';
import { researchConfig } from './research.config';
import { encryptionConfig } from './encryption.config';
import { newsConfig } from './news.config';
import { authConfig } from './auth.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // pnpm --filter runs with cwd = apps/api/, so ../../.env is the
      // monorepo-root .env (single source of truth for dev credentials).
      // Local apps/api/.env wins if present (overrides).
      envFilePath: [join(process.cwd(), '.env'), join(process.cwd(), '../../.env')],
      validate: (config: Record<string, unknown>) => envSchema.parse(config),
      load: [
        databaseConfig,
        redisConfig,
        jwtConfig,
        aiConfig,
        polygonConfig,
        tradingConfig,
        personaConfig,
        storageConfig,
        okxConfig,
        alpacaConfig,
        openbbConfig,
        fmpConfig,
        ragConfig,
        archivalConfig,
        chatConfig,
        firecrawlConfig,
        mcpConfig,
        marketProviderConfig,
        researchConfig,
        encryptionConfig,
        newsConfig,
        authConfig,
      ],
    }),
  ],
})
export class AppConfigModule {}
