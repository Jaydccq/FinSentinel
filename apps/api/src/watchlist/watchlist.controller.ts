import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  saveWatchlistRequestSchema,
  updateWatchlistCategoryRequestSchema,
  updateWatchlistItemRequestSchema,
  type SaveWatchlistRequest,
  type UpdateWatchlistCategoryRequest,
  type UpdateWatchlistItemRequest,
  type WatchlistCategoryResponse,
  type WatchlistItemResponse,
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
  async list(@CurrentUser() user: CurrentUserPayload): Promise<WatchlistOverviewResponse> {
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

  // ── F-6: item-level CRUD ─────────────────────────────────────────────

  /** PATCH /watchlist/items/:id — update thesis / notes / priority. */
  @Patch('items/:id')
  async updateItem(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateWatchlistItemRequestSchema))
    body: UpdateWatchlistItemRequest,
  ): Promise<WatchlistItemResponse> {
    return this.service.updateItem(user.userId, id, body);
  }

  /** DELETE /watchlist/items/:id — remove a single item. */
  @Delete('items/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteItem(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.service.deleteItem(user.userId, id);
  }

  // ── F-6: category-level CRUD ─────────────────────────────────────────

  /**
   * PATCH /watchlist/categories/:id — rename / update metadata. Renames that
   * would collide with another of the user's categories surface as 409.
   */
  @Patch('categories/:id')
  async updateCategory(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateWatchlistCategoryRequestSchema))
    body: UpdateWatchlistCategoryRequest,
  ): Promise<WatchlistCategoryResponse> {
    try {
      return await this.service.updateCategory(user.userId, id, body);
    } catch (err) {
      if (err instanceof Error && err.message.includes('already exists')) {
        throw new ConflictException(err.message);
      }
      throw err;
    }
  }

  /** DELETE /watchlist/categories/:id — cascades to items via FK. */
  @Delete('categories/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCategory(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.service.deleteCategory(user.userId, id);
  }
}
