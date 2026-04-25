import type { StructuredChunk, StructuredDocument } from '../structured-document';

const QUESTION_RE = /^(?:Q\s*[:.]?|Question\s*[:.]?|#{1,3}\s*Q\d+)\s*/i;
const ANSWER_RE = /^(?:A\s*[:.]?|Answer\s*[:.]?)\s*/i;

export interface QaChunkerConfig {
  chunkSize: number; // unused for hard limit today; Q/A pairs stay whole
  minChunkChars?: number; // default 20
}

export class QaChunker {
  constructor(private readonly config: QaChunkerConfig = { chunkSize: 800 }) {}

  chunk(doc: StructuredDocument): StructuredChunk[] {
    const output: StructuredChunk[] = [];
    for (const input of doc.chunks) {
      if (input.modality !== 'text') {
        output.push(input);
        continue;
      }
      const pairs = this.findQaPairs(input.text);
      const minLen = this.config.minChunkChars ?? 20;
      for (const pair of pairs) {
        if (pair.length < minLen) continue;
        output.push({
          text: pair,
          title: input.title,
          sectionPath: input.sectionPath,
          parentId: null,
          modality: 'text',
          pageStart: input.pageStart,
          pageEnd: input.pageEnd,
        });
      }
    }
    return output;
  }

  private findQaPairs(text: string): string[] {
    const lines = text.split(/\n+/);
    const pairs: string[] = [];
    let current: string[] = [];
    let state: 'idle' | 'in-q' | 'in-a' = 'idle';

    const flush = () => {
      if (current.length) pairs.push(current.join('\n'));
      current = [];
    };

    for (const line of lines) {
      if (QUESTION_RE.test(line)) {
        flush();
        current = [line];
        state = 'in-q';
      } else if (ANSWER_RE.test(line)) {
        if (state === 'idle') continue; // skip orphan answers
        current.push(line);
        state = 'in-a';
      } else if (state === 'in-q' || state === 'in-a') {
        current.push(line);
        // Once inside a pair, all subsequent non-question lines extend the answer.
        if (state === 'in-q') state = 'in-a';
      }
    }
    flush();
    return pairs;
  }
}
