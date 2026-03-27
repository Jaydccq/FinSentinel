import { Module } from '@nestjs/common';
import { AppConfigModule } from './config';
import { HealthController } from './health/health.controller';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [AppConfigModule, AuthModule],
  controllers: [HealthController],
})
export class AppModule {}
