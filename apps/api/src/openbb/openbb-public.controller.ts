import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { OpenbbPublicDataService } from './openbb-public.service';

/**
 * OpenBB public data controller — generic query endpoint and provider listing.
 *
 * Rate-limited to 30 requests per 60 seconds.
 */
@Controller('openbb/public')
@UseGuards(JwtGuard)
@RateLimit({ limit: 30, windowSecs: 60 })
@UseGuards(RateLimitGuard)
export class OpenbbPublicController {
  constructor(private readonly publicService: OpenbbPublicDataService) {}

  /**
   * GET /openbb/public/providers — list available data providers.
   *
   * Stub: returns well-known provider names. A real implementation
   * would query the OpenBB Platform for its registered providers.
   */
  @Get('providers')
  async listProviders() {
    return {
      providers: [
        'polygon',
        'fred',
        'fmp',
        'intrinio',
        'alpha_vantage',
        'yfinance',
      ],
    };
  }

  /**
   * GET /openbb/public/query — generic OpenBB Platform query.
   *
   * @param path     - API path (e.g. "equity/price/quote")
   * @param provider - data provider override (e.g. "polygon")
   * @param params   - additional query params as JSON string
   */
  @Get('query')
  async query(
    @Query('path') path: string,
    @Query('provider') provider?: string,
    @Query('params') paramsStr?: string,
  ) {
    let params: Record<string, string> | undefined;
    if (paramsStr) {
      try {
        params = JSON.parse(paramsStr) as Record<string, string>;
      } catch {
        params = undefined;
      }
    }

    return this.publicService.queryPublicData(path, provider, params);
  }
}
