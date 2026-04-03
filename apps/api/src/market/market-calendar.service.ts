import { Injectable, Logger } from '@nestjs/common';
import { OpenbbPublicDataService } from '../openbb/openbb-public.service';

/**
 * Market calendar data (earnings, dividends, splits) via OpenBB Platform.
 *
 * All methods delegate to OpenbbPublicDataService and return raw JSON.
 */
@Injectable()
export class MarketCalendarService {
  private readonly logger = new Logger(MarketCalendarService.name);

  constructor(private readonly openbb: OpenbbPublicDataService) {}

  /**
   * Upcoming earnings calendar from OpenBB.
   *
   * @param startDate - optional start date (YYYY-MM-DD)
   * @param endDate   - optional end date (YYYY-MM-DD)
   */
  async getEarningsCalendar(
    startDate?: string,
    endDate?: string,
  ): Promise<unknown> {
    this.logger.debug(
      `Fetching earnings calendar: ${startDate ?? 'no start'} to ${endDate ?? 'no end'}`,
    );

    const params: Record<string, string> = {};
    if (startDate) params['start_date'] = startDate;
    if (endDate) params['end_date'] = endDate;

    return this.openbb.queryPublicData(
      'equity/calendar/earnings',
      undefined,
      params,
    );
  }

  /**
   * Upcoming dividend calendar from OpenBB.
   *
   * @param startDate - optional start date (YYYY-MM-DD)
   * @param endDate   - optional end date (YYYY-MM-DD)
   */
  async getDividendCalendar(
    startDate?: string,
    endDate?: string,
  ): Promise<unknown> {
    this.logger.debug(
      `Fetching dividend calendar: ${startDate ?? 'no start'} to ${endDate ?? 'no end'}`,
    );

    const params: Record<string, string> = {};
    if (startDate) params['start_date'] = startDate;
    if (endDate) params['end_date'] = endDate;

    return this.openbb.queryPublicData(
      'equity/calendar/dividend',
      undefined,
      params,
    );
  }

  /**
   * Upcoming stock splits calendar from OpenBB.
   *
   * @param startDate - optional start date (YYYY-MM-DD)
   * @param endDate   - optional end date (YYYY-MM-DD)
   */
  async getSplitsCalendar(
    startDate?: string,
    endDate?: string,
  ): Promise<unknown> {
    this.logger.debug(
      `Fetching splits calendar: ${startDate ?? 'no start'} to ${endDate ?? 'no end'}`,
    );

    const params: Record<string, string> = {};
    if (startDate) params['start_date'] = startDate;
    if (endDate) params['end_date'] = endDate;

    return this.openbb.queryPublicData(
      'equity/calendar/splits',
      undefined,
      params,
    );
  }

  async getUpcomingEarnings(ticker: string): Promise<unknown> {
    return this.openbb.queryPublicData(
      'equity/calendar/earnings',
      undefined,
      { symbol: ticker.toUpperCase() },
    );
  }

  async getDividendHistory(ticker: string): Promise<unknown> {
    return this.openbb.queryPublicData(
      'equity/calendar/dividend',
      undefined,
      { symbol: ticker.toUpperCase() },
    );
  }

  async getSplitHistory(ticker: string): Promise<unknown> {
    return this.openbb.queryPublicData(
      'equity/calendar/splits',
      undefined,
      { symbol: ticker.toUpperCase() },
    );
  }

  async getIPOCalendar(): Promise<string> {
    return 'IPO calendar is not available from the current OpenBB-backed market calendar service.';
  }
}
