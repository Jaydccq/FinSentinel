import { Injectable } from '@nestjs/common';

/**
 * Text cleaning service -- regex-based normalization for RAG pipeline.
 *
 * Applied after document parsing, before chunking:
 * 1. Remove null bytes
 * 2. Strip control characters (except newlines, tabs)
 * 3. Normalize unicode quotation marks to ASCII
 * 4. Trim leading/trailing whitespace per line
 * 5. Collapse multiple whitespace into single space (preserve paragraph breaks)
 * 6. Collapse 3+ newlines into double newline (paragraph separator)
 */
@Injectable()
export class TextCleaningService {
  /**
   * Clean raw text for downstream chunking and embedding.
   */
  clean(raw: string): string {
    if (!raw) return '';

    let text = raw;

    // 1. Remove null bytes
    text = text.replace(/\0/g, '');

    // 2. Strip control characters (except \n, \r, \t)
    // eslint-disable-next-line no-control-regex
    text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    // 3. Normalize unicode quotation marks to ASCII
    text = text
      .replace(/[\u2018\u2019\u201A\u201B]/g, "'") // single quotes
      .replace(/[\u201C\u201D\u201E\u201F]/g, '"') // double quotes
      .replace(/[\u2013\u2014]/g, '-') // en-dash, em-dash
      .replace(/\u2026/g, '...'); // ellipsis

    // 4. Trim leading/trailing whitespace per line
    text = text
      .split('\n')
      .map((line) => line.trim())
      .join('\n');

    // 5. Collapse multiple spaces/tabs into a single space (within lines)
    text = text.replace(/[^\S\n]+/g, ' ');

    // 6. Collapse 3+ consecutive newlines into exactly 2 (paragraph separator)
    text = text.replace(/\n{3,}/g, '\n\n');

    // 7. Final trim
    text = text.trim();

    return text;
  }
}
