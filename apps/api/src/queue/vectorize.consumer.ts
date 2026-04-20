import { Injectable, Inject, Optional, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { documents, documentChunks, eq, and } from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';
import { VECTORIZE_QUEUE } from './queue.constants';
import { DocumentParseService } from '../document/document-parse.service';
import { DocumentVectorService } from '../document/document-vector.service';
import { HybridStorageService } from '../storage/hybrid.storage';
import { ParserSidecarClient } from '../document/parser-sidecar.client';
import { GraphEnrichProducer } from './graph-enrich.producer';
import { RepresentationEnrichProducer } from './representation-enrich.producer';

export interface VectorizeJobData {
  docId: string;
}

/**
 * BullMQ worker that processes document vectorization jobs.
 *
 * Pipeline:
 * 1. Load Document record from DB
 * 2. Download raw content from storage
 * 3. Parse to clean text (DocumentParseService)
 * 4. Chunk + embed (DocumentVectorService)
 * 5. Update Document status to VECTORIZED or FAILED
 */
@Injectable()
export class VectorizeConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VectorizeConsumer.name);
  private worker!: Worker<VectorizeJobData>;

  constructor(
    @Inject('BULLMQ_CONNECTION') private readonly connection: ConnectionOptions,
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
    private readonly parseService: DocumentParseService,
    private readonly vectorService: DocumentVectorService,
    private readonly storage: HybridStorageService,
    @Optional() @Inject(ParserSidecarClient) private readonly parserSidecar?: ParserSidecarClient,
    @Optional() @Inject(GraphEnrichProducer) private readonly graphEnrichProducer?: GraphEnrichProducer,
    @Optional() @Inject(RepresentationEnrichProducer) private readonly representationEnrichProducer?: RepresentationEnrichProducer,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<VectorizeJobData>(
      VECTORIZE_QUEUE,
      async (job) => this.process(job),
      {
        connection: this.connection,
        concurrency: 2,
      },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Vectorize job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`,
      );
    });

    this.worker.on('completed', (job) => {
      this.logger.debug(`Vectorize job ${job.id} completed`);
    });

    this.logger.log('VectorizeConsumer worker started');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.logger.log('VectorizeConsumer worker stopped');
    }
  }

  /**
   * Process a single vectorization job.
   *
   * Exposed as a separate method to facilitate unit testing.
   */
  async process(job: Job<VectorizeJobData>): Promise<void> {
    const { docId } = job.data;
    this.logger.log(`Processing vectorization for document ${docId}`);

    // 1. Load document from DB
    const [doc] = await this.db
      .select({
        id: documents.id,
        storageKey: documents.storageKey,
        docType: documents.docType,
        sector: documents.sector,
        originalFileName: documents.originalFileName,
      })
      .from(documents)
      .where(eq(documents.id, docId))
      .limit(1);

    if (!doc) {
      throw new Error(`Document ${docId} not found`);
    }

    // 2. Download content from storage
    if (!doc.storageKey) {
      throw new Error(`Document ${docId} has no storageKey`);
    }
    const content = await this.storage.download(doc.storageKey);

    // 3. Determine MIME type from file extension
    const mimeType = this.guessMimeType(doc.originalFileName);

    // 4. Parse to clean text — PDF/DOC/DOCX go through the parser sidecar when
    //    available; all other MIME types use the synchronous parseService path.
    const SIDECAR_MIMES = new Set([
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]);

    let text: string;
    let sidecarHints: { sourceMimeType: string; pageCount: number; parserVersion: string } | undefined;
    try {
      if (SIDECAR_MIMES.has(mimeType) && this.parserSidecar) {
        const result = await this.parserSidecar.parse(content, mimeType, doc.originalFileName);
        text = result.markdown;
        sidecarHints = {
          sourceMimeType: result.metadata.sourceMimeType,
          pageCount: result.metadata.pageCount,
          parserVersion: result.metadata.parserVersion,
        };
      } else {
        text = this.parseService.parseToCleanText(content, mimeType);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Document ${docId} parse failed: ${msg}`);
      await this.db
        .update(documents)
        .set({ status: 'FAILED' })
        .where(eq(documents.id, docId));
      throw err;
    }

    if (!text) {
      await this.db
        .update(documents)
        .set({ status: 'EMPTY' })
        .where(eq(documents.id, docId));
      this.logger.warn(`Document ${docId} produced no text, marked as EMPTY`);
      return;
    }

    // 5. Vectorize (chunk + embed + store)
    const chunkCount = await this.vectorService.vectorize(docId, text, {
      doc_type: doc.docType,
      sector: doc.sector ?? '',
      region_id: 'US',
      source: doc.originalFileName,
      date: new Date().toISOString().split('T')[0]!,
      __originalFileName: doc.originalFileName,
      ...(sidecarHints ? {
        parser_page_count: String(sidecarHints.pageCount),
        parser_version: sidecarHints.parserVersion,
        parser_source_mime: sidecarHints.sourceMimeType,
      } : {}),
    });

    // 6. Update status
    await this.db
      .update(documents)
      .set({ status: 'VECTORIZED', chunkCount })
      .where(eq(documents.id, docId));

    this.logger.log(`Document ${docId} vectorized: ${chunkCount} chunks`);

    // Enqueue graph enrichment as a separate job
    if (this.graphEnrichProducer) {
      try {
        await this.graphEnrichProducer.enqueue({ sourceType: 'document', sourceId: docId });
      } catch (error) {
        this.logger.warn(`Failed to enqueue graph enrichment for ${docId}: ${error}`);
      }
    }

    // Enqueue representation enrichment per chunk
    if (this.representationEnrichProducer) {
      try {
        const chunks = await this.db
          .select({ id: documentChunks.id })
          .from(documentChunks)
          .where(and(
            eq(documentChunks.sourceType, 'document'),
            eq(documentChunks.sourceId, docId),
          ));
        const chunkIds = chunks.map((c) => c.id);
        await this.representationEnrichProducer.enqueueMany(chunkIds);
      } catch (error) {
        this.logger.warn(`Failed to enqueue representation enrichment for ${docId}: ${error}`);
      }
    }
  }

  private guessMimeType(fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
    const mimeMap: Record<string, string> = {
      txt: 'text/plain',
      md: 'text/markdown',
      csv: 'text/csv',
      html: 'text/html',
      htm: 'text/html',
      xml: 'text/xml',
      json: 'application/json',
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    return mimeMap[ext] ?? 'text/plain';
  }
}
