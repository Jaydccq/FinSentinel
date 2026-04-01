import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import type { OkxApiClient } from './okx-api.client';
import { OkxPriceService } from './okx-price.service';

/**
 * OKX controller — account, positions, orders, funding rate, and ticker data.
 *
 * All endpoints require JWT auth and an active OKX client.
 * Throws 503 if OKX integration is disabled or misconfigured.
 */
@Controller('okx')
@UseGuards(JwtGuard)
export class OkxController {
  constructor(
    @Inject('OKX_API_CLIENT') private readonly client: OkxApiClient | null,
    private readonly priceService: OkxPriceService,
  ) {}

  /** GET /okx/account — account balance. */
  @Get('account')
  async getAccount() {
    this.ensureClient();
    return this.client!.getAccountBalance();
  }

  /** GET /okx/positions — all open positions. */
  @Get('positions')
  async getPositions() {
    this.ensureClient();
    return this.client!.getPositions();
  }

  /** GET /okx/orders — pending orders (stub, delegates to positions for now). */
  @Get('orders')
  async getOrders() {
    this.ensureClient();
    // OKX API does not have a simple "list orders" in our client yet;
    // return empty until we add GET /api/v5/trade/orders-pending
    return [];
  }

  /** GET /okx/funding-rate/:instId — funding rate for a perpetual swap. */
  @Get('funding-rate/:instId')
  async getFundingRate(@Param('instId') instId: string) {
    this.ensureClient();
    return this.client!.getFundingRate(instId);
  }

  /** GET /okx/ticker/:instId — ticker data for an instrument. */
  @Get('ticker/:instId')
  async getTicker(@Param('instId') instId: string) {
    this.ensureClient();
    return this.client!.getTicker(instId);
  }

  /** GET /okx/price/:instId — cached mid-price from the price service. */
  @Get('price/:instId')
  async getPrice(@Param('instId') instId: string) {
    const price = this.priceService.getPrice(instId);
    return { instId, price };
  }

  /** GET /okx/price-snapshot — all cached tickers. */
  @Get('price-snapshot')
  async getPriceSnapshot() {
    const snapshot = this.priceService.getSnapshot();
    const entries: Array<{ instId: string; price: number | null }> = [];
    for (const [instId] of snapshot) {
      entries.push({ instId, price: this.priceService.getPrice(instId) });
    }
    return entries;
  }

  private ensureClient(): void {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'OKX integration is disabled or not configured. Set APP_OKX_ENABLED=true and provide credentials.',
      );
    }
  }
}
