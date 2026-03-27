import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RateLimiterService } from './services/rate-limiter.service';
import { RateLimitGuard } from './guards/rate-limit.guard';

const redisProvider = {
  provide: 'REDIS',
  useFactory: (configService: ConfigService) => {
    return new Redis(configService.get<string>('REDIS_URL')!);
  },
  inject: [ConfigService],
};

@Module({
  providers: [redisProvider, RateLimiterService, RateLimitGuard],
  exports: [RateLimiterService, RateLimitGuard, 'REDIS'],
})
export class CommonModule {}
