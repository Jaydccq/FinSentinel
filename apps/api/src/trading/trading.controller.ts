import {
  Controller,
  Post,
  Get,
  Put,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  stageRequestSchema,
  unifiedStageRequestSchema,
  commitRequestSchema,
  switchModeRequestSchema,
  TradingMode,
  Contract,
} from '@finsentinel/shared';
import type {
  StageRequest,
  UnifiedStageRequest,
  CommitRequest,
  SwitchModeRequest,
  V2WalletResponse,
  V2CommitResponse,
  V2StagedResponse,
} from '@finsentinel/shared';
import { JwtGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { UnifiedTradingService } from './unified-trading.service';

/**
 * Trading controller — v1 legacy + v2 UTA endpoints.
 *
 * v1 endpoints return human-readable text or simple objects.
 * v2 endpoints return structured typed responses.
 */
@Controller('trading')
@UseGuards(JwtGuard)
export class TradingController {
  constructor(private readonly tradingService: UnifiedTradingService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // v1 Endpoints
  // ═══════════════════════════════════════════════════════════════════════════

  @Post('stage')
  async stage(
    @CurrentUser() user: CurrentUserPayload,
    @Body(new ZodValidationPipe(stageRequestSchema)) body: StageRequest,
  ) {
    // Convert v1 StageRequest to UnifiedStageRequest format
    const unified: UnifiedStageRequest = {
      action: body.action,
      symbol: body.ticker,
      qty: body.shares,
      amount: body.amount,
    };
    const count = await this.tradingService.stage(user.userId, unified);
    return { message: `Staged ${body.action} ${body.ticker} (${count} operations staged)` };
  }

  @Get('staged')
  async getStaged(@CurrentUser() user: CurrentUserPayload) {
    const ops = await this.tradingService.getStagingArea(user.userId);
    return ops;
  }

  @Post('commit')
  async commit(
    @CurrentUser() user: CurrentUserPayload,
    @Body(new ZodValidationPipe(commitRequestSchema)) body: CommitRequest,
  ) {
    const result = await this.tradingService.commit(user.userId, body.message);
    return { message: `Committed ${result.count} operations (hash: ${result.hash.substring(0, 8)}...)` };
  }

  @Post('execute')
  async execute(@CurrentUser() user: CurrentUserPayload) {
    const result = await this.tradingService.execute(user.userId);
    return { message: result.report };
  }

  @Get('wallet')
  async getWallet(@CurrentUser() user: CurrentUserPayload) {
    const wallet = await this.tradingService.getOrCreateWallet(user.userId);
    const cashBalance = Number(wallet.cashBalance);
    const initialCapital = Number(wallet.initialCapital);
    const positions = wallet.positions as Array<{ shares: number; currentPrice?: number; avgCost: number }>;
    let positionValue = 0;
    for (const pos of positions) {
      positionValue += pos.shares * (pos.currentPrice ?? pos.avgCost);
    }
    const totalValue = cashBalance + positionValue;
    const returnPercent = ((totalValue - initialCapital) / initialCapital) * 100;

    return {
      initialCapital: initialCapital.toFixed(2),
      cashBalance: cashBalance.toFixed(2),
      positions: wallet.positions,
      totalValue: totalValue.toFixed(2),
      returnPercent: returnPercent.toFixed(2),
      tradingMode: wallet.tradingMode,
    };
  }

  @Get('history')
  async getHistory(
    @CurrentUser() user: CurrentUserPayload,
    @Query('limit') limitParam?: string,
  ) {
    const raw = limitParam ? parseInt(limitParam, 10) : 10;
    const limit = Math.min(Math.max(isNaN(raw) ? 10 : raw, 1), 50);
    const log = await this.tradingService.getCommitLog(user.userId, limit);
    return { history: log };
  }

  @Put('mode')
  @HttpCode(HttpStatus.OK)
  async switchMode(
    @CurrentUser() user: CurrentUserPayload,
    @Body(new ZodValidationPipe(switchModeRequestSchema)) body: SwitchModeRequest,
  ) {
    await this.tradingService.switchMode(user.userId, body.mode as TradingMode);
    return { message: `Trading mode switched to ${body.mode}` };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // v2 UTA Endpoints
  // ═══════════════════════════════════════════════════════════════════════════

  @Post('v2/stage')
  async v2Stage(
    @CurrentUser() user: CurrentUserPayload,
    @Body(new ZodValidationPipe(unifiedStageRequestSchema)) body: UnifiedStageRequest,
  ) {
    // Parse symbol through Contract for validation
    Contract.fromString(body.symbol);
    const count = await this.tradingService.stage(user.userId, body);
    return { message: `Staged ${body.action} ${body.symbol}`, count };
  }

  @Post('v2/commit')
  async v2Commit(
    @CurrentUser() user: CurrentUserPayload,
    @Body(new ZodValidationPipe(commitRequestSchema)) body: CommitRequest,
  ) {
    const result = await this.tradingService.commit(user.userId, body.message);
    return { hash: result.hash, count: result.count };
  }

  @Post('v2/execute')
  async v2Execute(@CurrentUser() user: CurrentUserPayload): Promise<V2CommitResponse> {
    const result = await this.tradingService.execute(user.userId);
    const commitData = result.commitData as {
      hash: string;
      message: string;
      timestamp: string;
      operations: Array<{ action?: unknown; symbol?: unknown; qty?: unknown; amount?: unknown; price?: unknown }>;
    };
    return {
      hash: commitData.hash,
      parentHash: '',
      message: commitData.message,
      timestamp: commitData.timestamp,
      operations: commitData.operations.map((op) => ({
        action: String(op.action ?? ''),
        symbol: String(op.symbol ?? ''),
        qty: String(op.qty ?? ''),
        amount: String(op.amount ?? ''),
        price: String(op.price ?? ''),
      })),
      results: result.results,
    };
  }

  @Get('v2/wallet')
  async v2Wallet(@CurrentUser() user: CurrentUserPayload): Promise<V2WalletResponse> {
    return this.tradingService.getWalletStatusStructured(user.userId);
  }

  @Get('v2/history')
  async v2History(
    @CurrentUser() user: CurrentUserPayload,
    @Query('limit') limitParam?: string,
  ): Promise<V2CommitResponse[]> {
    const raw = limitParam ? parseInt(limitParam, 10) : 10;
    const limit = Math.min(Math.max(isNaN(raw) ? 10 : raw, 1), 50);
    return this.tradingService.getCommitLogStructured(user.userId, limit);
  }

  @Get('v2/staged')
  async v2Staged(@CurrentUser() user: CurrentUserPayload): Promise<V2StagedResponse> {
    return this.tradingService.getStagedStructured(user.userId);
  }

  @Get('v2/search')
  async v2Search(
    @CurrentUser() user: CurrentUserPayload,
    @Query('query') query?: string,
  ) {
    if (!query || query.trim().length === 0) {
      return [];
    }
    return this.tradingService.searchAssets(user.userId, query);
  }
}
