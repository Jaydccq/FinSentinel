import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CommonModule } from '../common/common.module';
import { OpenbbPublicDataService } from './openbb-public.service';
import { OpenbbBusinessDataService } from './openbb-business.service';
import { OpenbbPublicController } from './openbb-public.controller';
import { OpenbbBusinessController } from './openbb-business.controller';

/**
 * OpenBB module -- conditionally loaded when OPENBB_ENABLED=true.
 *
 * Provides:
 * - OpenbbPublicDataService — generic query handler for OpenBB Platform v4 REST API
 * - OpenbbBusinessDataService — specialized US macro data queries (CPI, unemployment, fed funds)
 * - OpenbbPublicController — GET /openbb/public/providers, GET /openbb/public/query
 * - OpenbbBusinessController — GET /openbb/business/macro/us/{cpi,unemployment,fed-funds-rate}
 *
 * The module is registered in AppModule only when OpenBB integration is enabled.
 * See AppModule for conditional import logic.
 */
@Module({
  imports: [AuthModule, CommonModule],
  controllers: [OpenbbPublicController, OpenbbBusinessController],
  providers: [OpenbbPublicDataService, OpenbbBusinessDataService],
  exports: [OpenbbPublicDataService, OpenbbBusinessDataService],
})
export class OpenbbModule {}
