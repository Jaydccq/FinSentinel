import { Module } from '@nestjs/common';
import { AppConfigModule } from './config';
import { HealthController } from './health/health.controller';

@Module({
  imports: [AppConfigModule],
  controllers: [HealthController],
})
export class AppModule {}
