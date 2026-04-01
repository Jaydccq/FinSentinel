import { Module } from '@nestjs/common';
import { TextCleaningService } from './text-cleaning.service';
import { DocumentParseService } from './document-parse.service';
import { DocumentChunkingService } from './document-chunking.service';
import { DocumentVectorService } from './document-vector.service';
import { DocumentUploadService } from './document-upload.service';
import { StorageModule } from '../storage/storage.module';

/**
 * Document module -- RAG document processing pipeline.
 *
 * Provides:
 * - TextCleaningService — regex text normalization
 * - DocumentParseService — parse PDF/text to plain text
 * - DocumentChunkingService — split text into overlapping chunks
 * - DocumentVectorService — embed chunks into pgvector
 * - DocumentUploadService — upload + persist + queue for vectorization
 *
 * Imports StorageModule for file storage (hot tier via RustFS).
 */
@Module({
  imports: [StorageModule],
  providers: [
    TextCleaningService,
    DocumentParseService,
    DocumentChunkingService,
    DocumentVectorService,
    DocumentUploadService,
  ],
  exports: [
    TextCleaningService,
    DocumentParseService,
    DocumentChunkingService,
    DocumentVectorService,
    DocumentUploadService,
  ],
})
export class DocumentModule {}
