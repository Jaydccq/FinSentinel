import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { OpenbbBusinessDataService } from './openbb-business.service';

/**
 * OpenBB business data controller — pre-configured US macro indicator endpoints.
 *
 * Rate-limited to 30 requests per 60 seconds.
 */
@Controller('openbb/business/macro/us')
@UseGuards(JwtGuard)
@RateLimit({ limit: 30, windowSecs: 60 })
@UseGuards(RateLimitGuard)
export class OpenbbBusinessController {
  constructor(private readonly businessService: OpenbbBusinessDataService) {}

  /** GET /openbb/business/macro/us/cpi — US Consumer Price Index. */
  @Get('cpi')
  async getCpi(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
  ) {
    return this.businessService.getUsCpi(
      startDate,
      endDate,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  /** GET /openbb/business/macro/us/unemployment — US unemployment rate. */
  @Get('unemployment')
  async getUnemployment(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
  ) {
    return this.businessService.getUsUnemploymentRate(
      startDate,
      endDate,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  /** GET /openbb/business/macro/us/fed-funds-rate — US Federal Funds Rate. */
  @Get('fed-funds-rate')
  async getFedFundsRate(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
  ) {
    return this.businessService.getUsFedFundsRate(
      startDate,
      endDate,
      limit ? parseInt(limit, 10) : undefined,
    );
  }
}
