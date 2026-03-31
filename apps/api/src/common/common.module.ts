import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RateLimiterService } from './services/rate-limiter.service';
import { RateLimitGuard } from './guards/rate-limit.guard';
import { EncryptionService } from './services/encryption.service';
import { ApiKeyService } from './services/api-key.service';

const redisProvider = {
  provide: 'REDIS',
  useFactory: (configService: ConfigService) => {
    return new Redis(configService.get<string>('REDIS_URL')!);
  },
  inject: [ConfigService],
};

@Module({
  providers: [
    redisProvider,
    RateLimiterService,
    RateLimitGuard,
    EncryptionService,
    ApiKeyService,
  ],
  exports: [RateLimiterService, RateLimitGuard, 'REDIS', EncryptionService, ApiKeyService],
})
export class CommonModule {}
