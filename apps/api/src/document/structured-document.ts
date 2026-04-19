/**
 * Structured document types for heading-aware chunking.
 *
 * MarkdownStructureService produces StructuredChunk objects. These flow through
 * DocumentChunkingService.chunkStructured and into RagChunkStoreService so the
 * section_path / meta_title columns on document_chunks are populated.
 */

export interface StructuredChunk {
  text: string;
  title: string | null;      // closest enclosing heading text
  sectionPath: string[];     // ["Chapter 1", "1.2 Risks", "1.2.3 FX"]
  parentId: string | null;   // set by DocumentVectorService before insert (null at chunker output)
  modality: 'text' | 'table' | 'image' | 'pdf_page';
  pageStart: number | null;
  pageEnd: number | null;
}

export interface StructuredDocument {
  chunks: StructuredChunk[];
  sourceFormat: 'markdown' | 'plain';
}
