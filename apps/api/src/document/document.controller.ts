import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
  Inject,
  Res,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { documents, eq, and, desc } from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';
import { JwtGuard } from '../auth/jwt.guard';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { DocumentUploadService } from './document-upload.service';
import { parseIntParam } from '../common/utils/parse-int-param';
import { RagReindexService } from '../rag/rag-reindex.service';

/** Minimal multer file shape (avoids @types/multer dependency). */
interface MulterFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

/**
 * Document controller — upload, list, get, and delete RAG documents.
 *
 * Upload rate-limited to 20 requests per 60 seconds.
 */
@Controller('documents')
@UseGuards(JwtGuard)
export class DocumentController {
  constructor(
    private readonly uploadService: DocumentUploadService,
    private readonly ragReindexService: RagReindexService,
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
  ) {}

  /** Upload a document for RAG vectorization. */
  @Post()
  @RateLimit({ limit: 20, windowSecs: 60 })
  @UseGuards(RateLimitGuard)
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @CurrentUser() user: CurrentUserPayload,
    @UploadedFile() file: MulterFile | undefined,
    @Query('docType') docType?: string,
    @Query('sector') sector?: string,
    @Query('regionId') regionId?: string,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    return this.uploadService.upload(
      {
        buffer: file.buffer,
        mimetype: file.mimetype,
        originalname: file.originalname,
      },
      user.userId,
      docType ?? 'GENERAL',
      sector,
      regionId, // undefined → service falls back to 'US'
    );
  }

  /** Requeue documents owned by the current user that are missing stored chunks. */
  @Post('reindex-missing')
  @RateLimit({ limit: 3, windowSecs: 300 })
  @UseGuards(RateLimitGuard)
  async reindexMissing(
    @CurrentUser() user: CurrentUserPayload,
    @Query('limit') limitParam?: string,
    @Query('force') forceParam?: string,
  ) {
    const limit = parseIntParam(limitParam, 100, 1, 500);
    const force = forceParam === 'true';
    return this.ragReindexService.reindexMissingDocumentsForUser(
      user.userId,
      limit,
      force,
    );
  }

  /** Requeue a single document for vectorization, even if it was previously marked VECTORIZED. */
  @Post(':id/reindex')
  @RateLimit({ limit: 10, windowSecs: 300 })
  @UseGuards(RateLimitGuard)
  async reindexOne(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    const result = await this.ragReindexService.reindexDocumentById(user.userId, id);
    if (result.queued === 0) {
      throw new NotFoundException(`Document ${id} not found`);
    }
    return result;
  }

  /** List documents with optional filters and pagination. */
  @Get()
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Query('status') status?: string,
    @Query('docType') docType?: string,
    @Query('page') pageParam?: string,
    @Query('size') sizeParam?: string,
  ) {
    const page = parseIntParam(pageParam, 0, 0, 1000);
    const size = parseIntParam(sizeParam, 20, 1, 100);
    const offset = page * size;

    // Build conditions dynamically
    const conditions = [eq(documents.userId, user.userId)];
    if (status) {
      conditions.push(eq(documents.status, status));
    }
    if (docType) {
      conditions.push(eq(documents.docType, docType));
    }

    const rows = await this.db
      .select()
      .from(documents)
      .where(and(...conditions))
      .orderBy(desc(documents.createdAt))
      .limit(size)
      .offset(offset);

    return rows;
  }

  /** Download a document by ID. */
  @Get(':id/download')
  async download(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rows = await this.db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.userId, user.userId)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException(`Document ${id} not found`);
    }

    const doc = rows[0]!;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${doc.fileName ?? `document-${id}`}"`,
    );

    // TODO: Wire to HybridStorageService.download() when storage is active
    // For now return document metadata as placeholder
    return Buffer.from(JSON.stringify(doc));
  }

  /** Get a single document by ID. */
  @Get(':id')
  async getOne(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    const rows = await this.db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.userId, user.userId)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException(`Document ${id} not found`);
    }

    return rows[0];
  }

  /** Delete a document by ID. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    // Verify ownership before deleting
    const rows = await this.db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.userId, user.userId)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException(`Document ${id} not found`);
    }

    await this.db
      .delete(documents)
      .where(eq(documents.id, id));
  }
}
