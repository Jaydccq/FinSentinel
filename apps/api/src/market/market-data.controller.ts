import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { parseIntParam } from '../common/utils/parse-int-param';
import { MarketDataService } from './market-data.service';

/**
 * Market data controller — public market data endpoints.
 *
 * GET /market/quote/:ticker   — get stock quote
 * GET /market/history/:ticker — get historical bars (param: days)
 * GET /market/search          — search tickers (param: query)
 */
@Controller('market')
@UseGuards(JwtGuard)
export class MarketDataController {
  constructor(private readonly marketDataService: MarketDataService) {}

  @Get('quote/:ticker')
  async getQuote(@Param('ticker') ticker: string) {
    return this.marketDataService.getQuote(ticker);
  }

  @Get('history/:ticker')
  async getHistory(
    @Param('ticker') ticker: string,
    @Query('days') daysParam?: string,
  ) {
    const days = parseIntParam(daysParam, 30, 1, 365);
    return this.marketDataService.getHistoricalBars(ticker, days);
  }

  @Get('search')
  async searchTickers(@Query('query') query?: string) {
    if (!query || query.trim().length === 0) {
      return [];
    }
    return this.marketDataService.searchTickers(query);
  }
}
