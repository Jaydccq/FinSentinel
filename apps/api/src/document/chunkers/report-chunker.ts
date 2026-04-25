import type { StructuredChunk, StructuredDocument } from '../structured-document';

export interface ReportChunkerConfig {
  chunkSize: number;
  chunkOverlap: number; // ignored today; kept for API parity with other chunkers
  minChunkSizeChars: number;
  maxNumChunks: number;
}

export class ReportChunker {
  constructor(private readonly config: ReportChunkerConfig) {}

  chunk(doc: StructuredDocument): StructuredChunk[] {
    const output: StructuredChunk[] = [];
    for (const input of doc.chunks) {
      // Non-text modalities (table, image, pdf_page) pass through as-is.
      if (input.modality !== 'text') {
        output.push(input);
        continue;
      }
      if (!input.text || input.text.trim().length === 0) continue;

      if (input.text.length <= this.config.chunkSize) {
        if (input.text.trim().length >= this.config.minChunkSizeChars) {
          output.push(input);
        }
      } else {
        const parts = this.splitAtSentence(input.text, this.config.chunkSize);
        for (const part of parts) {
          if (part.trim().length >= this.config.minChunkSizeChars) {
            output.push({
              ...input,
              text: part,
              parentId: null,
            });
          }
        }
      }

      if (output.length >= this.config.maxNumChunks) {
        return output.slice(0, this.config.maxNumChunks);
      }
    }
    return output;
  }

  private splitAtSentence(text: string, maxLen: number): string[] {
    const sentences = text.split(/(?<=[.!?])\s+/);
    const result: string[] = [];
    let current = '';
    for (const s of sentences) {
      const candidate = current ? `${current} ${s}` : s;
      if (candidate.length <= maxLen) {
        current = candidate;
      } else {
        if (current) result.push(current);
        current = s;
      }
    }
    if (current) result.push(current);
    return result;
  }
}
