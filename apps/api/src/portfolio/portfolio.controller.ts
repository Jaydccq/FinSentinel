import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { portfolioRequestSchema, holdingRequestSchema } from '@finsentinel/shared';
import type { PortfolioRequest, HoldingRequest } from '@finsentinel/shared';
import { PortfolioService } from './portfolio.service';

@Controller('portfolios')
@UseGuards(JwtGuard)
export class PortfolioController {
  constructor(private readonly portfolioService: PortfolioService) {}

  // ── Portfolio CRUD ─────────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createPortfolio(
    @CurrentUser() user: CurrentUserPayload,
    @Body(new ZodValidationPipe(portfolioRequestSchema)) body: PortfolioRequest,
  ) {
    return this.portfolioService.createPortfolio(user.userId, body);
  }

  @Get()
  async getPortfolios(@CurrentUser() user: CurrentUserPayload) {
    return this.portfolioService.getPortfolios(user.userId);
  }

  @Get(':id')
  async getPortfolio(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.portfolioService.getPortfolio(user.userId, id);
  }

  @Put(':id')
  async updatePortfolio(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(portfolioRequestSchema)) body: PortfolioRequest,
  ) {
    return this.portfolioService.updatePortfolio(user.userId, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deletePortfolio(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    await this.portfolioService.deletePortfolio(user.userId, id);
  }

  // ── Holding CRUD ───────────────────────────────────────────────────────

  @Post(':portfolioId/holdings')
  @HttpCode(HttpStatus.CREATED)
  async addHolding(
    @CurrentUser() user: CurrentUserPayload,
    @Param('portfolioId') portfolioId: string,
    @Body(new ZodValidationPipe(holdingRequestSchema)) body: HoldingRequest,
  ) {
    return this.portfolioService.addHolding(user.userId, portfolioId, body);
  }

  @Get(':portfolioId/holdings')
  async getHoldings(
    @CurrentUser() user: CurrentUserPayload,
    @Param('portfolioId') portfolioId: string,
  ) {
    return this.portfolioService.getHoldings(user.userId, portfolioId);
  }

  @Put(':portfolioId/holdings/:holdingId')
  async updateHolding(
    @CurrentUser() user: CurrentUserPayload,
    @Param('portfolioId') portfolioId: string,
    @Param('holdingId') holdingId: string,
    @Body(new ZodValidationPipe(holdingRequestSchema)) body: HoldingRequest,
  ) {
    return this.portfolioService.updateHolding(
      user.userId,
      portfolioId,
      holdingId,
      body,
    );
  }

  @Delete(':portfolioId/holdings/:holdingId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteHolding(
    @CurrentUser() user: CurrentUserPayload,
    @Param('portfolioId') portfolioId: string,
    @Param('holdingId') holdingId: string,
  ) {
    await this.portfolioService.deleteHolding(
      user.userId,
      portfolioId,
      holdingId,
    );
  }

  // ── Analytics ──────────────────────────────────────────────────────────

  @Get(':id/analytics')
  async getPortfolioAnalytics(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.portfolioService.getPortfolioAnalytics(user.userId, id);
  }
}
