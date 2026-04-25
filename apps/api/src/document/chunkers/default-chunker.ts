import { Logger } from '@nestjs/common';
import type { StructuredChunk, StructuredDocument } from '../structured-document';

export interface DefaultChunkerConfig {
  chunkSize: number;
  chunkOverlap: number;
  minChunkSizeChars: number;
  maxNumChunks: number;
}

export class DefaultChunker {
  private readonly logger = new Logger(DefaultChunker.name);

  constructor(private readonly config: DefaultChunkerConfig) {}

  chunk(doc: StructuredDocument): StructuredChunk[] {
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
        this.logger.warn(`Structured chunk count reached max (${maxNumChunks}), truncating`);
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
            chunkOverlap > 0 && current.length > chunkOverlap ? current.slice(-chunkOverlap) : '';
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
