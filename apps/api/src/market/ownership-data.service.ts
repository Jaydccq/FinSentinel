import { Injectable, Logger } from '@nestjs/common';
import { OpenbbPublicDataService } from '../openbb/openbb-public.service';

/**
 * Ownership data (institutional holders, insider transactions) via OpenBB Platform.
 *
 * All methods delegate to OpenbbPublicDataService and return raw JSON.
 */
@Injectable()
export class OwnershipDataService {
  private readonly logger = new Logger(OwnershipDataService.name);

  constructor(private readonly openbb: OpenbbPublicDataService) {}

  /**
   * Institutional holders for a given ticker.
   *
   * @param ticker - stock symbol (e.g. "AAPL")
   */
  async getInstitutionalHolders(ticker: string): Promise<unknown> {
    this.logger.debug(`Fetching institutional holders for ${ticker}`);

    return this.openbb.queryPublicData('equity/ownership/institutional', undefined, {
      symbol: ticker.toUpperCase(),
    });
  }

  /**
   * Insider trading transactions for a given ticker.
   *
   * @param ticker - stock symbol (e.g. "AAPL")
   */
  async getInsiderTransactions(ticker: string): Promise<unknown> {
    this.logger.debug(`Fetching insider transactions for ${ticker}`);

    return this.openbb.queryPublicData('equity/ownership/insider_trading', undefined, {
      symbol: ticker.toUpperCase(),
    });
  }
}
