import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  saveWatchlistRequestSchema,
  type SaveWatchlistRequest,
  type WatchlistCategoryResponse,
  type WatchlistOverviewResponse,
} from '@finsentinel/shared';
import { JwtGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { WatchlistService } from './watchlist.service';

/**
 * Watchlist controller — exposes the REST surface that the frontend uses to
 * read/write categories and items. The service already implements the logic;
 * this controller is intentionally thin.
 */
@Controller('watchlist')
@UseGuards(JwtGuard)
export class WatchlistController {
  constructor(private readonly service: WatchlistService) {}

  /** GET /watchlist — return all of the current user's categories with items. */
  @Get()
  async list(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<WatchlistOverviewResponse> {
    return this.service.getWatchlist(user.userId);
  }

  /** POST /watchlist — upsert a category and its items in one call. */
  @Post()
  async save(
    @CurrentUser() user: CurrentUserPayload,
    @Body(new ZodValidationPipe(saveWatchlistRequestSchema))
    body: SaveWatchlistRequest,
  ): Promise<WatchlistCategoryResponse> {
    return this.service.saveWatchlistItems(user.userId, body);
  }
}
