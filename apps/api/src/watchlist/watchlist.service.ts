import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, watchlistCategories, watchlistItems } from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';
import type {
  WatchlistCategoryResponse,
  WatchlistItemResponse,
  WatchlistOverviewResponse,
} from '@finsentinel/shared';

export interface WatchlistItemInput {
  symbol: string;
  companyName?: string;
  thesis?: string;
  notes?: string;
  priority?: number;
}

export interface SaveWatchlistCategoryInput {
  categoryName: string;
  categoryDescription?: string;
  categorySummary?: string;
  items: WatchlistItemInput[];
}

export interface OrganizeWatchlistCategoryInput {
  categoryName: string;
  categoryDescription?: string;
  categorySummary?: string;
  items?: WatchlistItemInput[];
}

export interface UpdateWatchlistItemInput {
  companyName?: string;
  thesis?: string;
  notes?: string;
  priority?: number;
}

export interface UpdateWatchlistCategoryInput {
  name?: string;
  description?: string;
  summary?: string;
}

@Injectable()
export class WatchlistService {
  constructor(@Inject('DRIZZLE_DB') private readonly db: DrizzleDB) {}

  async saveWatchlistItems(
    userId: string,
    input: SaveWatchlistCategoryInput,
  ): Promise<WatchlistCategoryResponse> {
    const category = await this.upsertCategory(userId, input.categoryName, {
      description: input.categoryDescription,
      summary: input.categorySummary,
    });

    await this.upsertItems(userId, category.id, input.items);

    return this.getCategoryById(category.id, userId);
  }

  async organizeWatchlistCategory(
    userId: string,
    input: OrganizeWatchlistCategoryInput,
  ): Promise<WatchlistCategoryResponse> {
    const category = await this.upsertCategory(userId, input.categoryName, {
      description: input.categoryDescription,
      summary: input.categorySummary,
    });

    if (input.items && input.items.length > 0) {
      await this.upsertItems(userId, category.id, input.items);
    }

    return this.getCategoryById(category.id, userId);
  }

  async getWatchlist(userId: string, categoryName?: string): Promise<WatchlistOverviewResponse> {
    const categories = categoryName
      ? await this.db
          .select()
          .from(watchlistCategories)
          .where(
            and(
              eq(watchlistCategories.userId, userId),
              eq(watchlistCategories.key, this.toCategoryKey(categoryName)),
            ),
          )
          .orderBy(asc(watchlistCategories.name))
      : await this.db
          .select()
          .from(watchlistCategories)
          .where(eq(watchlistCategories.userId, userId))
          .orderBy(asc(watchlistCategories.name));

    if (categories.length === 0) {
      return { categories: [] };
    }

    const items = await this.db
      .select()
      .from(watchlistItems)
      .where(
        inArray(
          watchlistItems.categoryId,
          categories.map((category) => category.id),
        ),
      )
      .orderBy(desc(watchlistItems.priority), asc(watchlistItems.symbol));

    const itemsByCategory = new Map<string, WatchlistItemResponse[]>();
    for (const item of items) {
      if (!itemsByCategory.has(item.categoryId)) {
        itemsByCategory.set(item.categoryId, []);
      }
      itemsByCategory.get(item.categoryId)!.push(this.toWatchlistItemResponse(item));
    }

    return {
      categories: categories.map((category) =>
        this.toWatchlistCategoryResponse(category, itemsByCategory.get(category.id) ?? []),
      ),
    };
  }

  private async upsertCategory(
    userId: string,
    categoryName: string,
    metadata: { description?: string; summary?: string },
  ): Promise<typeof watchlistCategories.$inferSelect> {
    const normalizedName = this.normalizeCategoryName(categoryName);
    const key = this.toCategoryKey(normalizedName);
    const [existing] = await this.db
      .select()
      .from(watchlistCategories)
      .where(and(eq(watchlistCategories.userId, userId), eq(watchlistCategories.key, key)))
      .limit(1);

    const description = this.normalizeOptionalText(metadata.description);
    const summary = this.normalizeOptionalText(metadata.summary);

    if (!existing) {
      const [created] = await this.db
        .insert(watchlistCategories)
        .values({
          userId,
          name: normalizedName,
          key,
          description,
          summary,
        })
        .returning();

      if (!created) {
        throw new Error(`Failed to create watchlist category ${normalizedName}`);
      }
      return created;
    }

    const [updated] = await this.db
      .update(watchlistCategories)
      .set({
        name: normalizedName,
        description: description ?? existing.description,
        summary: summary ?? existing.summary,
        updatedAt: new Date(),
      })
      .where(eq(watchlistCategories.id, existing.id))
      .returning();

    if (!updated) {
      throw new Error(`Failed to update watchlist category ${normalizedName}`);
    }
    return updated;
  }

  private async upsertItems(
    userId: string,
    categoryId: string,
    rawItems: WatchlistItemInput[],
  ): Promise<void> {
    const items = this.deduplicateItems(rawItems);
    if (items.length === 0) {
      return;
    }

    const symbols = items.map((item) => item.symbol);
    const existingItems = await this.db
      .select()
      .from(watchlistItems)
      .where(
        and(eq(watchlistItems.categoryId, categoryId), inArray(watchlistItems.symbol, symbols)),
      );

    const existingBySymbol = new Map(existingItems.map((item) => [item.symbol, item]));

    for (const item of items) {
      const existing = existingBySymbol.get(item.symbol);
      if (!existing) {
        await this.db.insert(watchlistItems).values({
          userId,
          categoryId,
          symbol: item.symbol,
          companyName: this.normalizeOptionalText(item.companyName),
          thesis: this.normalizeOptionalText(item.thesis),
          notes: this.normalizeOptionalText(item.notes),
          priority: item.priority ?? 0,
        });
        continue;
      }

      await this.db
        .update(watchlistItems)
        .set({
          companyName: this.normalizeOptionalText(item.companyName) ?? existing.companyName,
          thesis: this.normalizeOptionalText(item.thesis) ?? existing.thesis,
          notes: this.normalizeOptionalText(item.notes) ?? existing.notes,
          priority: item.priority ?? existing.priority,
          updatedAt: new Date(),
        })
        .where(eq(watchlistItems.id, existing.id));
    }
  }

  private deduplicateItems(rawItems: WatchlistItemInput[]): Array<Required<WatchlistItemInput>> {
    const bySymbol = new Map<string, Required<WatchlistItemInput>>();

    for (const rawItem of rawItems) {
      const symbol = this.normalizeSymbol(rawItem.symbol);
      const existing = bySymbol.get(symbol);
      const normalizedCompanyName = this.normalizeOptionalText(rawItem.companyName) ?? '';
      const normalizedThesis = this.normalizeOptionalText(rawItem.thesis) ?? '';
      const normalizedNotes = this.normalizeOptionalText(rawItem.notes) ?? '';
      bySymbol.set(symbol, {
        symbol,
        companyName: normalizedCompanyName || existing?.companyName || '',
        thesis: normalizedThesis || existing?.thesis || '',
        notes: normalizedNotes || existing?.notes || '',
        priority: rawItem.priority ?? existing?.priority ?? 0,
      });
    }

    return [...bySymbol.values()];
  }

  private async getCategoryById(
    categoryId: string,
    userId: string,
  ): Promise<WatchlistCategoryResponse> {
    const overview = await this.getWatchlist(userId);
    const category = overview.categories.find((entry) => entry.id === categoryId);
    if (!category) {
      throw new Error(`Watchlist category ${categoryId} was not found after update`);
    }
    return category;
  }

  private toWatchlistCategoryResponse(
    category: typeof watchlistCategories.$inferSelect,
    items: WatchlistItemResponse[],
  ): WatchlistCategoryResponse {
    return {
      id: category.id,
      name: category.name,
      key: category.key,
      description: category.description ?? '',
      summary: category.summary ?? '',
      itemCount: items.length,
      items,
      createdAt: category.createdAt.toISOString(),
      updatedAt: category.updatedAt.toISOString(),
    };
  }

  private toWatchlistItemResponse(item: typeof watchlistItems.$inferSelect): WatchlistItemResponse {
    return {
      id: item.id,
      symbol: item.symbol,
      companyName: item.companyName ?? '',
      thesis: item.thesis ?? '',
      notes: item.notes ?? '',
      priority: item.priority,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private normalizeCategoryName(name: string): string {
    const normalized = name.trim().replace(/\s+/g, ' ');
    if (!normalized) {
      throw new Error('Category name cannot be empty');
    }
    return normalized;
  }

  private toCategoryKey(name: string): string {
    return this.normalizeCategoryName(name).toLocaleLowerCase('en-US');
  }

  private normalizeSymbol(symbol: string): string {
    const normalized = symbol.trim().toUpperCase();
    if (!normalized) {
      throw new Error('Symbol cannot be empty');
    }
    return normalized;
  }

  private normalizeOptionalText(value?: string): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }

  // ── F-6: item + category level CRUD ──────────────────────────────────

  /**
   * Patch a single watchlist item. Returns the updated item. Throws
   * NotFoundException when the item doesn't exist OR belongs to a
   * different user (avoids leaking existence of cross-tenant rows).
   */
  async updateItem(
    userId: string,
    itemId: string,
    patch: UpdateWatchlistItemInput,
  ): Promise<WatchlistItemResponse> {
    const [existing] = await this.db
      .select()
      .from(watchlistItems)
      .where(and(eq(watchlistItems.id, itemId), eq(watchlistItems.userId, userId)))
      .limit(1);
    if (!existing) throw new NotFoundException(`Watchlist item ${itemId} not found`);

    const [updated] = await this.db
      .update(watchlistItems)
      .set({
        companyName:
          patch.companyName === undefined
            ? existing.companyName
            : this.normalizeOptionalText(patch.companyName),
        thesis:
          patch.thesis === undefined ? existing.thesis : this.normalizeOptionalText(patch.thesis),
        notes: patch.notes === undefined ? existing.notes : this.normalizeOptionalText(patch.notes),
        priority: patch.priority ?? existing.priority,
        updatedAt: new Date(),
      })
      .where(eq(watchlistItems.id, itemId))
      .returning();
    if (!updated) throw new Error(`Failed to update watchlist item ${itemId}`);
    return this.toWatchlistItemResponse(updated);
  }

  async deleteItem(userId: string, itemId: string): Promise<void> {
    const deleted = await this.db
      .delete(watchlistItems)
      .where(and(eq(watchlistItems.id, itemId), eq(watchlistItems.userId, userId)))
      .returning({ id: watchlistItems.id });
    if (deleted.length === 0) {
      throw new NotFoundException(`Watchlist item ${itemId} not found`);
    }
  }

  /**
   * Patch a category's metadata. Renames are supported but require that
   * the new name doesn't collide with another category owned by the same
   * user — conflicts surface as a 409 via the controller.
   */
  async updateCategory(
    userId: string,
    categoryId: string,
    patch: UpdateWatchlistCategoryInput,
  ): Promise<WatchlistCategoryResponse> {
    const [existing] = await this.db
      .select()
      .from(watchlistCategories)
      .where(and(eq(watchlistCategories.id, categoryId), eq(watchlistCategories.userId, userId)))
      .limit(1);
    if (!existing) throw new NotFoundException(`Watchlist category ${categoryId} not found`);

    const normalizedName = patch.name ? this.normalizeCategoryName(patch.name) : existing.name;
    const newKey = this.toCategoryKey(normalizedName);

    if (newKey !== existing.key) {
      const [collision] = await this.db
        .select({ id: watchlistCategories.id })
        .from(watchlistCategories)
        .where(and(eq(watchlistCategories.userId, userId), eq(watchlistCategories.key, newKey)))
        .limit(1);
      if (collision && collision.id !== existing.id) {
        throw new Error(`Watchlist category name already exists: ${normalizedName}`);
      }
    }

    const description =
      patch.description === undefined
        ? existing.description
        : this.normalizeOptionalText(patch.description);
    const summary =
      patch.summary === undefined ? existing.summary : this.normalizeOptionalText(patch.summary);

    await this.db
      .update(watchlistCategories)
      .set({
        name: normalizedName,
        key: newKey,
        description,
        summary,
        updatedAt: new Date(),
      })
      .where(eq(watchlistCategories.id, categoryId));

    return this.getCategoryById(categoryId, userId);
  }

  async deleteCategory(userId: string, categoryId: string): Promise<void> {
    // FK to watchlist_items is ON DELETE CASCADE — children go with the parent.
    const deleted = await this.db
      .delete(watchlistCategories)
      .where(and(eq(watchlistCategories.id, categoryId), eq(watchlistCategories.userId, userId)))
      .returning({ id: watchlistCategories.id });
    if (deleted.length === 0) {
      throw new NotFoundException(`Watchlist category ${categoryId} not found`);
    }
  }
}
