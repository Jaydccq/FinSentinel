import {
  Controller,
  Post,
  Param,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtGuard } from '../auth/jwt.guard';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { OkxAnalysisService } from './okx-analysis.service';
import type { OkxApiClient } from './okx-api.client';
import { randomUUID } from 'crypto';

/**
 * OKX analysis controller — AI-powered SSE streaming for crypto derivatives.
 *
 * Both endpoints produce SSE streams in the FinSentinel format.
 */
@Controller('okx/analysis')
@UseGuards(JwtGuard)
export class OkxAnalysisController {
  constructor(
    private readonly analysisService: OkxAnalysisService,
    @Inject('OKX_API_CLIENT') private readonly client: OkxApiClient | null,
  ) {}

  /** POST /okx/analysis/stream/:instId — stream AI analysis for a perpetual swap. */
  @Post('stream/:instId')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 5, windowSecs: 300 })
  @UseGuards(RateLimitGuard)
  async streamAnalysis(
    @Param('instId') instId: string,
    @CurrentUser() _user: CurrentUserPayload,
    @Res() res: Response,
  ) {
    this.ensureClient();

    const sessionId = randomUUID();
    const sseStream = await this.analysisService.streamAnalysis(instId, sessionId);

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

  /** POST /okx/analysis/health — health check for OKX integration. */
  @Post('health')
  @HttpCode(HttpStatus.OK)
  async healthCheck(@CurrentUser() _user: CurrentUserPayload) {
    if (!this.client) {
      return { status: 'disabled', message: 'OKX integration is not configured' };
    }

    // Try fetching a well-known ticker as connectivity check
    const ticker = await this.client.getTicker('BTC-USDT-SWAP');
    if (ticker) {
      return {
        status: 'healthy',
        message: 'OKX API is reachable',
        lastPrice: ticker.last,
      };
    }

    return { status: 'degraded', message: 'OKX API reachable but no ticker data returned' };
  }

  private ensureClient(): void {
    if (!this.client) {
      throw new ServiceUnavailableException('OKX integration is disabled or not configured.');
    }
  }
}
