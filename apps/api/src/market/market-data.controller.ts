import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { parseIntParam } from '../common/utils/parse-int-param';
import { MarketDataService } from './market-data.service';

/**
 * Market data controller — public market data endpoints.
 *
 * GET  /market/quote/:ticker   — get stock quote
 * GET  /market/history/:ticker — get historical bars (param: days)
 * GET  /market/search          — search tickers (params: q, limit)
 * POST /market/batch-quotes    — get quotes for multiple tickers
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
  async searchTickers(
    @Query('q') query?: string,
    @Query('limit') limitParam?: string,
  ) {
    if (!query || query.trim().length === 0) return [];
    const limit = parseIntParam(limitParam, 8, 1, 50);
    return this.marketDataService.searchTickers(query, limit);
  }

  @Post('batch-quotes')
  async getBatchQuotes(@Body() tickers: string[]) {
    if (!Array.isArray(tickers) || tickers.length === 0) return {};
    const results: Record<string, unknown> = {};
    await Promise.all(
      tickers.slice(0, 20).map(async (ticker) => {
        try {
          results[ticker] = await this.marketDataService.getQuote(ticker);
        } catch {
          // Skip failed tickers silently
        }
      }),
    );
    return results;
  }
}
