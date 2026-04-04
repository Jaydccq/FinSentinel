import { Injectable, Logger, Inject, BadRequestException, Optional } from '@nestjs/common';
import { documents, eq } from '@finsentinel/db';
import { HybridStorageService } from '../storage/hybrid.storage';
import { DocumentParseService } from './document-parse.service';
import { DocumentVectorService } from './document-vector.service';
import { VectorizeProducer } from '../queue/vectorize.producer';

/** Maximum file size: 50 MB */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/** Allowed MIME types for document upload. */
const ALLOWED_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'text/xml',
  'application/json',
  'application/xml',
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Inject('DRIZZLE_DB') private readonly db: any,
    private readonly storage: HybridStorageService,
    private readonly parseService: DocumentParseService,
    private readonly vectorService: DocumentVectorService,
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
  ): Promise<UploadResult> {
    // 1. Validate
    this.validate(file);

    // 2. Generate storage key
    const timestamp = Date.now();
    const safeFileName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storageKey = `documents/${userId}/${timestamp}_${safeFileName}`;

    // 3. Upload to storage
    await this.storage.upload(storageKey, file.buffer, file.mimetype);
    this.logger.log(`Uploaded file to storage: ${storageKey}`);

    // 4. Create DB record with status=PENDING
    const [doc] = await this.db
      .insert(documents)
      .values({
        fileName: safeFileName,
        originalFileName: file.originalname,
        docType,
        status: 'PENDING',
        sector: sector ?? null,
        regionId: 'US',
        userId,
        fileSize: file.buffer.length,
        storageKey,
        storageTier: 'HOT',
      })
      .returning({ id: documents.id });

    this.logger.log(`Created document record: ${doc.id} (status=PENDING)`);

    // 5. Dispatch to BullMQ queue if available, otherwise fall back to sync
    if (this.vectorizeProducer) {
      await this.vectorizeProducer.send(doc.id);
      return { id: doc.id, status: 'PENDING' };
    }

    // Synchronous fallback (used when QueueModule is not loaded)
    try {
      const text = this.parseService.parseToCleanText(file.buffer, file.mimetype);
      const uploadDate = new Date().toISOString().slice(0, 10);

      if (text) {
        const chunkCount = await this.vectorService.vectorize(doc.id, text, {
          doc_type: docType,
          sector: sector ?? '',
          region_id: 'US',
          source: file.originalname,
          date: uploadDate,
        });

        await this.db
          .update(documents)
          .set({ status: 'VECTORIZED', chunkCount })
          .where(eq(documents.id, doc.id));

        this.logger.log(`Document ${doc.id} vectorized: ${chunkCount} chunks`);
        return { id: doc.id, status: 'VECTORIZED' };
      } else {
        await this.db
          .update(documents)
          .set({ status: 'EMPTY' })
          .where(eq(documents.id, doc.id));

        return { id: doc.id, status: 'EMPTY' };
      }
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

    if (file.buffer.length > MAX_FILE_SIZE) {
      throw new BadRequestException(
        `File exceeds maximum size of ${MAX_FILE_SIZE / (1024 * 1024)} MB`,
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
