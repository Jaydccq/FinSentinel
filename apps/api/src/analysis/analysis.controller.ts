import {
  Controller,
  Post,
  Param,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtGuard } from '../auth/jwt.guard';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { StockAnalysisService } from '../agent/stock-analysis.service';
import { randomUUID } from 'crypto';

/** Ticker format: 1-10 alphanumeric or hyphen characters (e.g. AAPL, BTC, BRK-B). */
const TICKER_REGEX = /^[A-Za-z0-9\-]{1,10}$/;

/**
 * Analysis controller — SSE streaming of AI-powered stock analysis.
 *
 * Rate-limited to 5 requests per 5 minutes.
 */
@Controller('analysis')
@UseGuards(JwtGuard)
export class AnalysisController {
  constructor(private readonly stockAnalysisService: StockAnalysisService) {}

  @Post('stream/:ticker')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 5, windowSecs: 300 })
  @UseGuards(RateLimitGuard)
  async streamAnalysis(
    @Param('ticker') ticker: string,
    @CurrentUser() _user: CurrentUserPayload,
    @Res() res: Response,
  ) {
    const upperTicker = ticker.toUpperCase();

    if (!TICKER_REGEX.test(ticker)) {
      throw new BadRequestException(
        `Invalid ticker format: ${ticker}. Expected 1-10 alphanumeric or hyphen characters.`,
      );
    }

    const sessionId = randomUUID();
    const message = `Provide a comprehensive analysis of ${upperTicker} including current price, key technical indicators, and a risk assessment.`;

    const sseStream = await this.stockAnalysisService.streamAnalysis(
      message,
      [{ role: 'user', content: message }],
      sessionId,
    );

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const reader = sseStream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } finally {
      res.end();
    }
  }
}
