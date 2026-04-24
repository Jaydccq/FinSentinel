import { Module, forwardRef } from '@nestjs/common';
import { TextCleaningService } from './text-cleaning.service';
import { DocumentParseService } from './document-parse.service';
import { DocumentChunkingService } from './document-chunking.service';
import { MarkdownStructureService } from './markdown-structure.service';
import { DocumentVectorService } from './document-vector.service';
import { DocumentUploadService } from './document-upload.service';
import { DocumentReconcilerService } from './document-reconciler.service';
import { DocumentController } from './document.controller';
import { StorageModule } from '../storage/storage.module';
import { AuthModule } from '../auth/auth.module';
import { CommonModule } from '../common/common.module';
import { RagModule } from '../rag/rag.module';

/**
 * Document module -- RAG document processing pipeline.
 *
 * Provides:
 * - TextCleaningService — regex text normalization
 * - DocumentParseService — parse PDF/text to plain text
 * - DocumentChunkingService — split text into overlapping chunks
 * - MarkdownStructureService — heading-aware markdown parser
 * - DocumentVectorService — embed chunks into pgvector
 * - DocumentUploadService — upload + persist + queue for vectorization
 * - DocumentController — REST endpoints for upload, list, get, delete
 *
 * Imports StorageModule for file storage (hot tier via RustFS).
 */
@Module({
  imports: [StorageModule, AuthModule, CommonModule, forwardRef(() => RagModule)],
  controllers: [DocumentController],
  providers: [
    TextCleaningService,
    DocumentParseService,
    DocumentChunkingService,
    MarkdownStructureService,
    DocumentVectorService,
    DocumentUploadService,
    // F-4: self-healing cron for stuck PENDING_UPLOAD rows (@Cron runs
    // every 10 minutes; see DocumentReconcilerService for details).
    DocumentReconcilerService,
  ],
  exports: [
    TextCleaningService,
    DocumentParseService,
    DocumentChunkingService,
    MarkdownStructureService,
    DocumentVectorService,
    DocumentUploadService,
    DocumentReconcilerService,
  ],
})
export class DocumentModule {}
