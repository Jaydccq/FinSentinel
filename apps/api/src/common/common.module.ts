import { Module, forwardRef } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RateLimiterService } from './services/rate-limiter.service';
import { RateLimitGuard } from './guards/rate-limit.guard';
import { EncryptionService } from './services/encryption.service';
import { ApiKeyService } from './services/api-key.service';
import { PdfService } from './services/pdf.service';
import { MetricsService } from './services/metrics.service';
import { MetricsInterceptor } from './interceptors/metrics.interceptor';
import { ApiKeyController } from './controllers/api-key.controller';
import { MetricsController } from './controllers/metrics.controller';
import { AuthModule } from '../auth/auth.module';

const redisProvider = {
  provide: 'REDIS',
  useFactory: (configService: ConfigService) => {
    return new Redis(configService.get<string>('REDIS_URL')!);
  },
  inject: [ConfigService],
};

@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [ApiKeyController, MetricsController],
  providers: [
    redisProvider,
    RateLimiterService,
    RateLimitGuard,
    EncryptionService,
    ApiKeyService,
    PdfService,
    MetricsService,
    {
      provide: APP_INTERCEPTOR,
      useClass: MetricsInterceptor,
    },
  ],
  exports: [
    RateLimiterService,
    RateLimitGuard,
    'REDIS',
    EncryptionService,
    ApiKeyService,
    PdfService,
    MetricsService,
  ],
})
export class CommonModule {}
