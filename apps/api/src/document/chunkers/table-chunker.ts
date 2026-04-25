import type { StructuredChunk, StructuredDocument } from '../structured-document';

export interface TableChunkerConfig {
  chunkSize: number;
}

export class TableChunker {
  constructor(private readonly config: TableChunkerConfig) {}

  chunk(doc: StructuredDocument): StructuredChunk[] {
    const output: StructuredChunk[] = [];
    for (const input of doc.chunks) {
      if (input.modality !== 'table') {
        output.push(input);
        continue;
      }

      const [header, separator, ...rows] = input.text.split(/\n/);
      // If the table doesn't look like a markdown table (missing header or
      // separator row), or fits in the chunk budget, emit it as-is.
      if (
        !header ||
        !separator ||
        rows.length === 0 ||
        input.text.length <= this.config.chunkSize
      ) {
        output.push(input);
        continue;
      }

      const headerBlock = `${header}\n${separator}`;
      let current: string[] = [];
      let currentLen = headerBlock.length;

      const flush = () => {
        if (current.length === 0) return;
        output.push({
          text: `${headerBlock}\n${current.join('\n')}`,
          title: input.title,
          sectionPath: input.sectionPath,
          parentId: null,
          modality: 'table',
          pageStart: input.pageStart,
          pageEnd: input.pageEnd,
        });
        current = [];
        currentLen = headerBlock.length;
      };

      for (const row of rows) {
        // Emit before overflow so each chunk stays at or under chunkSize.
        if (currentLen + row.length + 1 > this.config.chunkSize && current.length > 0) {
          flush();
        }
        current.push(row);
        currentLen += row.length + 1;
      }
      flush();
    }
    return output;
  }
}
