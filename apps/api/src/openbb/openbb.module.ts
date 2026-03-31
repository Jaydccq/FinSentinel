import { Module } from '@nestjs/common';
import { OpenbbPublicDataService } from './openbb-public.service';
import { OpenbbBusinessDataService } from './openbb-business.service';

/**
 * OpenBB module -- conditionally loaded when OPENBB_ENABLED=true.
 *
 * Provides:
 * - OpenbbPublicDataService — generic query handler for OpenBB Platform v4 REST API
 * - OpenbbBusinessDataService — specialized US macro data queries (CPI, unemployment, fed funds)
 *
 * The module is registered in AppModule only when OpenBB integration is enabled.
 * See AppModule for conditional import logic.
 */
@Module({
  providers: [OpenbbPublicDataService, OpenbbBusinessDataService],
  exports: [OpenbbPublicDataService, OpenbbBusinessDataService],
})
export class OpenbbModule {}
