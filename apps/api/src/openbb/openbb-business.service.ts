import { Injectable, Logger } from '@nestjs/common';
import { OpenbbPublicDataService } from './openbb-public.service';

/**
 * Default business-level route configuration for macro data queries.
 *
 * Business-facing OpenBB defaults and route helpers.
 */
const BUSINESS_DEFAULTS = {
  macroProvider: 'fred',
  cpiPath: 'economy/cpi',
  cpiSeriesId: 'CPIAUCSL',
  unemploymentPath: 'economy/unemployment',
  unemploymentSeriesId: 'UNRATE',
  fedFundsPath: 'economy/federal_funds_rate',
  fedFundsSeriesId: 'FEDFUNDS',
} as const;

/**
 * Specialized macro data query service that delegates to OpenbbPublicDataService.
 *
 * Provides opinionated methods for common US macro indicators (CPI, unemployment,
 * fed funds rate) with pre-configured paths and FRED series IDs.
 */
@Injectable()
export class OpenbbBusinessDataService {
  private readonly logger = new Logger(OpenbbBusinessDataService.name);

  constructor(private readonly publicService: OpenbbPublicDataService) {}

  /**
   * Get US Consumer Price Index (CPI) data.
   *
   * @param startDate - optional start date (YYYY-MM-DD)
   * @param endDate   - optional end date (YYYY-MM-DD)
   * @param limit     - optional max number of results
   */
  async getUsCpi(
    startDate?: string,
    endDate?: string,
    limit?: number,
  ): Promise<unknown> {
    return this.queryFredLikeSeries(
      BUSINESS_DEFAULTS.cpiPath,
      BUSINESS_DEFAULTS.macroProvider,
      BUSINESS_DEFAULTS.cpiSeriesId,
      startDate,
      endDate,
      limit,
    );
  }

  /**
   * Get US unemployment rate data.
   *
   * @param startDate - optional start date (YYYY-MM-DD)
   * @param endDate   - optional end date (YYYY-MM-DD)
   * @param limit     - optional max number of results
   */
  async getUsUnemploymentRate(
    startDate?: string,
    endDate?: string,
    limit?: number,
  ): Promise<unknown> {
    return this.queryFredLikeSeries(
      BUSINESS_DEFAULTS.unemploymentPath,
      BUSINESS_DEFAULTS.macroProvider,
      BUSINESS_DEFAULTS.unemploymentSeriesId,
      startDate,
      endDate,
      limit,
    );
  }

  /**
   * Get US Federal Funds Rate data.
   *
   * @param startDate - optional start date (YYYY-MM-DD)
   * @param endDate   - optional end date (YYYY-MM-DD)
   * @param limit     - optional max number of results
   */
  async getUsFedFundsRate(
    startDate?: string,
    endDate?: string,
    limit?: number,
  ): Promise<unknown> {
    return this.queryFredLikeSeries(
      BUSINESS_DEFAULTS.fedFundsPath,
      BUSINESS_DEFAULTS.macroProvider,
      BUSINESS_DEFAULTS.fedFundsSeriesId,
      startDate,
      endDate,
      limit,
    );
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private queryFredLikeSeries(
    path: string,
    provider: string,
    seriesId: string,
    startDate?: string,
    endDate?: string,
    limit?: number,
  ): Promise<unknown> {
    const params: Record<string, string> = {};

    if (seriesId) {
      params['series_id'] = seriesId;
    }
    if (startDate) {
      params['start_date'] = startDate;
    }
    if (endDate) {
      params['end_date'] = endDate;
    }
    if (limit !== undefined && limit !== null && limit > 0) {
      params['limit'] = String(limit);
    }

    return this.publicService.queryPublicData(path, provider, params);
  }
}
