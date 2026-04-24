import { Injectable, Logger, Inject, BadRequestException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { documents, eq } from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';
import { HybridStorageService } from '../storage/hybrid.storage';
import { DocumentParseService } from './document-parse.service';
import { DocumentVectorService } from './document-vector.service';
import { VectorizeProducer } from '../queue/vectorize.producer';
import { resolveRegion } from './region-inference';

/** Allowed MIME types for document upload. */
const ALLOWED_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'text/xml',
  'application/json',
  'application/xml',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

export interface UploadResult {
  id: string;
  status: string;
}

/**
 * Document upload service -- validates, stores, persists, and queues for vectorization.
 *
 * Flow:
 * 1. Validate file (size, MIME type)
 * 2. Upload to StorageService (hot tier via HybridStorageService)
 * 3. Create Document record in DB with status=PENDING
 * 4. If VectorizeProducer is available, enqueue async vectorization job
 * 5. Otherwise, fall back to synchronous parse + vectorize
 */
@Injectable()
export class DocumentUploadService {
  private readonly logger = new Logger(DocumentUploadService.name);

  constructor(
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
    private readonly storage: HybridStorageService,
    private readonly parseService: DocumentParseService,
    private readonly vectorService: DocumentVectorService,
    private readonly config: ConfigService,
    @Optional() private readonly vectorizeProducer?: VectorizeProducer,
  ) {}

  /**
   * Upload a document: validate, store, persist, and queue for vectorization.
   *
   * @param file - The uploaded file (buffer, mimetype, originalname)
   * @param userId - ID of the uploading user
   * @param docType - Document type (e.g. 'SEC_FILING', 'RESEARCH', 'NEWS')
   * @param sector - Optional sector tag (e.g. 'Technology', 'Healthcare')
   * @returns Upload result with document ID and status
   */
  async upload(
    file: UploadedFile,
    userId: string,
    docType: string,
    sector?: string,
    regionId?: string,
  ): Promise<UploadResult> {
    // 1. Validate
    this.validate(file);

    // 1b. Resolve regionId. When the caller supplies one (typically a scraper
    //     that already knows the region), honor it. Otherwise run filename
    //     heuristics and fall back to 'UNKNOWN' so the retrieval layer gets a
    //     clear signal rather than a wrong default.
    const regionOutcome = resolveRegion(file.originalname, regionId);
    if (regionOutcome.inferredFrom) {
      this.logger.debug(
        `regionId inferred: value=${regionOutcome.regionId} ` +
          `rule=${regionOutcome.inferredFrom} file=${file.originalname}`,
      );
    } else if (regionOutcome.regionId === 'UNKNOWN') {
      this.logger.warn(
        `regionId=UNKNOWN (no rule matched): file=${file.originalname}`,
      );
    }
    const resolvedRegionId = regionOutcome.regionId;

    // 2. Production guard: refuse synchronous fallback when configured to.
    const requireAsync = this.config.get<boolean>(
      'rag.documents.requireAsyncVectorize',
      false,
    );
    if (requireAsync && !this.vectorizeProducer) {
      throw new Error(
        'async vectorization required: rag.documents.requireAsyncVectorize=true ' +
          'but no VectorizeProducer is bound (QueueModule must be loaded)',
      );
    }

    // 3. Generate storage key
    const timestamp = Date.now();
    const safeFileName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storageKey = `documents/${userId}/${timestamp}_${safeFileName}`;

    // 4. F-4 outbox step 1: insert the DB row as PENDING_UPLOAD *before*
    //    touching storage. If storage then fails, the row is marked
    //    FAILED rather than leaving orphan bytes (the old order had a
    //    compensating storage.delete which relied on exceptions reaching
    //    the catch — a process kill between storage.upload and db.insert
    //    would have leaked an object).
    const insertResult = await this.db
      .insert(documents)
      .values({
        fileName: safeFileName,
        originalFileName: file.originalname,
        docType,
        status: 'PENDING_UPLOAD',
        sector: sector ?? null,
        regionId: resolvedRegionId,
        userId,
        fileSize: file.buffer.length,
        storageKey,
        storageTier: 'HOT',
      })
      .returning({ id: documents.id });
    const inserted = insertResult[0];
    if (!inserted) throw new Error('Failed to insert document record');
    const doc: { id: string } = inserted;

    // 5. Upload to storage. On failure, mark the row FAILED so the
    //    reconciler (future work) can clean it up; re-throw so the
    //    caller sees the error.
    try {
      await this.storage.upload(storageKey, file.buffer, file.mimetype);
      this.logger.log(`Uploaded file to storage: ${storageKey}`);
    } catch (err) {
      try {
        await this.db
          .update(documents)
          .set({ status: 'FAILED' })
          .where(eq(documents.id, doc.id));
      } catch (markErr) {
        this.logger.error(
          `Failed to mark document ${doc.id} FAILED after storage error: ${markErr}`,
        );
      }
      throw err;
    }

    // 6. Promote to PENDING (upload done, ready for vectorization).
    await this.db
      .update(documents)
      .set({ status: 'PENDING' })
      .where(eq(documents.id, doc.id));
    this.logger.log(`Created document record: ${doc.id} (status=PENDING)`);

    // 6. Dispatch to BullMQ queue if available, otherwise fall back to sync.
    if (this.vectorizeProducer) {
      await this.vectorizeProducer.send(doc.id);
      return { id: doc.id, status: 'PENDING' };
    }

    // Synchronous fallback (dev only). Production should set
    // DOCUMENTS_REQUIRE_ASYNC_VECTORIZE=true to assert above instead.
    const SIDECAR_MIMES = new Set([
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]);

    try {
      const text = SIDECAR_MIMES.has(file.mimetype)
        ? await this.parseService.parseToMarkdown(file.buffer, file.mimetype, file.originalname)
        : this.parseService.parseToCleanText(file.buffer, file.mimetype);
      const uploadDate = new Date().toISOString().slice(0, 10);

      if (text) {
        const chunkCount = await this.vectorService.vectorize(doc.id, text, {
          doc_type: docType,
          sector: sector ?? '',
          region_id: resolvedRegionId,
          source: file.originalname,
          date: uploadDate,
          __originalFileName: file.originalname,
        });

        await this.db
          .update(documents)
          .set({ status: 'VECTORIZED', chunkCount })
          .where(eq(documents.id, doc.id));

        this.logger.log(`Document ${doc.id} vectorized: ${chunkCount} chunks`);
        return { id: doc.id, status: 'VECTORIZED' };
      }

      await this.db
        .update(documents)
        .set({ status: 'EMPTY' })
        .where(eq(documents.id, doc.id));
      return { id: doc.id, status: 'EMPTY' };
    } catch (error) {
      this.logger.error(`Vectorization failed for ${doc.id}: ${error}`);
      await this.db
        .update(documents)
        .set({ status: 'FAILED' })
        .where(eq(documents.id, doc.id));

      return { id: doc.id, status: 'FAILED' };
    }
  }

  /** Validate file size and MIME type. */
  private validate(file: UploadedFile): void {
    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('File is empty');
    }

    const maxBytes = this.config.get<number>('rag.parser.uploadMaxBytes', 100 * 1024 * 1024);
    if (file.buffer.length > maxBytes) {
      throw new BadRequestException(
        `File exceeds maximum size of ${Math.floor(maxBytes / (1024 * 1024))} MB`,
      );
    }

    const normalizedMime =
      file.mimetype.toLowerCase().split(';', 1).at(0)?.trim() ?? '';
    if (!ALLOWED_MIME_TYPES.has(normalizedMime)) {
      throw new BadRequestException(
        `Unsupported file type: ${normalizedMime}. ` +
        `Allowed: ${[...ALLOWED_MIME_TYPES].join(', ')}`,
      );
    }
  }
}
