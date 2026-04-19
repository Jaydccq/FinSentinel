import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { StructuredChunk, StructuredDocument } from './structured-document';

export interface ChunkingConfig {
  chunkSize: number;
  chunkOverlap: number;
  minChunkSizeChars: number;
  maxNumChunks: number;
}

/**
 * Document chunking service -- splits text into overlapping chunks for embedding.
 *
 * Strategy (hierarchical boundary splitting):
 * 1. Split on paragraph boundaries (\n\n)
 * 2. If a paragraph exceeds chunkSize, split on sentence boundaries (. ! ?)
 * 3. If a sentence exceeds chunkSize, split on word boundaries
 * 4. Merge small segments into chunks up to chunkSize with overlap
 * 5. Filter out chunks smaller than minChunkSizeChars
 * 6. Cap total chunks at maxNumChunks
 *
 * Config defaults: chunkSize=500, chunkOverlap=50, minChunkSizeChars=200, maxNumChunks=10000
 */
@Injectable()
export class DocumentChunkingService {
  private readonly logger = new Logger(DocumentChunkingService.name);
  private readonly config: ChunkingConfig;

  constructor(@Inject(ConfigService) configService: ConfigService) {
    this.config = {
      chunkSize: configService.get<number>('rag.chunking.chunkSize', 500),
      chunkOverlap: configService.get<number>('rag.chunking.chunkOverlap', 50),
      minChunkSizeChars: configService.get<number>('rag.chunking.minChunkSizeChars', 200),
      maxNumChunks: configService.get<number>('rag.chunking.maxNumChunks', 10000),
    };
  }

  /**
   * Split cleaned text into overlapping chunks suitable for embedding.
   *
   * @param text - Cleaned text from DocumentParseService
   * @returns Array of text chunks
   */
  chunk(text: string): string[] {
    if (!text || text.trim().length === 0) {
      return [];
    }

    // Step 1: Split into segments at paragraph, sentence, then word level
    const segments = this.splitIntoSegments(text);

    // Step 2: Merge segments into chunks with overlap
    const chunks = this.mergeWithOverlap(segments);

    // Step 3: Filter out too-small chunks
    const filtered = chunks.filter(
      (c) => c.trim().length >= this.config.minChunkSizeChars,
    );

    // Step 4: Cap at maxNumChunks
    if (filtered.length > this.config.maxNumChunks) {
      this.logger.warn(
        `Chunk count (${filtered.length}) exceeds max (${this.config.maxNumChunks}), truncating`,
      );
      return filtered.slice(0, this.config.maxNumChunks);
    }

    return filtered;
  }

  /**
   * Split a StructuredDocument into output StructuredChunks.
   *
   * Tables and images are emitted as-is (one output chunk each) regardless of
   * chunkSize. If a table or image block exceeds 4 * chunkSize it is truncated
   * with a note appended. Text blocks that fit within chunkSize are emitted
   * as-is; those that exceed it are split using the same paragraph/sentence/word
   * hierarchy as chunk(), with each split inheriting the parent sectionPath and
   * title.
   *
   * Output chunks are emitted in document order. minChunkSizeChars and
   * maxNumChunks caps are applied to text blocks only (non-text blocks are
   * never filtered).
   *
   * @param doc - StructuredDocument from MarkdownStructureService
   * @returns Array of StructuredChunks ready for embedding
   */
  chunkStructured(doc: StructuredDocument): StructuredChunk[] {
    const { chunkSize, minChunkSizeChars, maxNumChunks } = this.config;
    const output: StructuredChunk[] = [];

    for (const inputChunk of doc.chunks) {
      if (inputChunk.modality !== 'text') {
        // Tables, images: emit as-is, truncate only if absurdly large
        const truncateAt = chunkSize * 4;
        if (inputChunk.text.length > truncateAt) {
          this.logger.warn(
            `Non-text chunk (modality=${inputChunk.modality}) exceeds 4x chunkSize ` +
            `(${inputChunk.text.length} chars); truncating`,
          );
          output.push({
            ...inputChunk,
            text: inputChunk.text.slice(0, truncateAt) + ' [truncated]',
          });
        } else {
          output.push(inputChunk);
        }
        continue;
      }

      // Text block
      if (!inputChunk.text || inputChunk.text.trim().length === 0) {
        continue;
      }

      if (inputChunk.text.length <= chunkSize) {
        if (inputChunk.text.trim().length >= minChunkSizeChars) {
          output.push(inputChunk);
        }
      } else {
        // Split the section text using the same paragraph/sentence/word logic
        const segments = this.splitIntoSegments(inputChunk.text);
        const splitTexts = this.mergeWithOverlap(segments).filter(
          (t) => t.trim().length >= minChunkSizeChars,
        );
        for (const splitText of splitTexts) {
          output.push({
            text: splitText,
            title: inputChunk.title,
            sectionPath: inputChunk.sectionPath,
            parentId: null,
            modality: 'text',
            pageStart: inputChunk.pageStart,
            pageEnd: inputChunk.pageEnd,
          });
        }
      }

      if (output.length >= maxNumChunks) {
        this.logger.warn(
          `Structured chunk count reached max (${maxNumChunks}), truncating`,
        );
        return output.slice(0, maxNumChunks);
      }
    }

    return output;
  }

  /**
   * Split text into segments that are each at most chunkSize characters.
   * Splits hierarchically: paragraphs -> sentences -> words.
   */
  private splitIntoSegments(text: string): string[] {
    const { chunkSize } = this.config;
    const paragraphs = text.split(/\n\n+/);
    const segments: string[] = [];

    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) continue;

      if (trimmed.length <= chunkSize) {
        segments.push(trimmed);
      } else {
        // Split paragraph into sentences
        const sentences = this.splitSentences(trimmed);
        for (const sentence of sentences) {
          if (sentence.length <= chunkSize) {
            segments.push(sentence);
          } else {
            // Split long sentence on word boundaries
            const words = this.splitWords(sentence, chunkSize);
            segments.push(...words);
          }
        }
      }
    }

    return segments;
  }

  /**
   * Split text on sentence boundaries (. ! ? followed by space or end of string).
   */
  private splitSentences(text: string): string[] {
    // Split on sentence-ending punctuation followed by whitespace
    const parts = text.split(/(?<=[.!?])\s+/);
    return parts.filter((p) => p.trim().length > 0);
  }

  /**
   * Split text on word boundaries when it exceeds maxLen.
   */
  private splitWords(text: string, maxLen: number): string[] {
    const words = text.split(/\s+/);
    const result: string[] = [];
    let current = '';

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= maxLen) {
        current = candidate;
      } else {
        if (current) result.push(current);
        // If a single word exceeds maxLen, include it anyway
        current = word;
      }
    }
    if (current) result.push(current);

    return result;
  }

  /**
   * Merge segments into chunks with overlap.
   * Each chunk is up to chunkSize characters. When starting a new chunk,
   * include the last chunkOverlap characters from the previous chunk.
   */
  private mergeWithOverlap(segments: string[]): string[] {
    const { chunkSize, chunkOverlap } = this.config;
    const chunks: string[] = [];
    let current = '';

    for (const segment of segments) {
      const separator = current ? '\n\n' : '';
      const candidate = current + separator + segment;

      if (candidate.length <= chunkSize) {
        current = candidate;
      } else {
        // Emit current chunk
        if (current) {
          chunks.push(current);
          // Build overlap prefix from the tail of the current chunk
          const overlapText =
            chunkOverlap > 0 && current.length > chunkOverlap
              ? current.slice(-chunkOverlap)
              : '';
          // Start new chunk with overlap + new segment
          if (overlapText && segment.length + overlapText.length + 1 <= chunkSize) {
            current = overlapText + ' ' + segment;
          } else {
            current = segment;
          }
        } else {
          // Segment alone exceeds chunkSize — emit it as-is
          chunks.push(segment);
          current = '';
        }
      }
    }

    // Emit remaining
    if (current) {
      chunks.push(current);
    }

    return chunks;
  }
}
