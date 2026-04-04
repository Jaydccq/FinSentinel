import { Injectable, Logger } from '@nestjs/common';
import { TextCleaningService } from './text-cleaning.service';

/**
 * Document parsing service -- converts raw file content to plain text.
 *
 * Supported formats:
 * - text/plain, text/markdown, text/csv, text/html — direct UTF-8 decode
 * - application/json — JSON.stringify with indentation
 * - application/pdf — logged warning, returns empty (pdf-parse can be added later)
 * - Other — logged warning, attempts UTF-8 decode
 *
 * After decoding, the text is passed through TextCleaningService for normalization.
 */
@Injectable()
export class DocumentParseService {
  private readonly logger = new Logger(DocumentParseService.name);

  private static readonly TEXT_MIME_TYPES = new Set([
    'text/plain',
    'text/markdown',
    'text/csv',
    'text/html',
    'text/xml',
    'application/xml',
  ]);

  constructor(private readonly textCleaning: TextCleaningService) {}

  /**
   * Parse raw file content to cleaned plain text.
   *
   * @param content - File content as a Buffer
   * @param mimeType - MIME type of the file (e.g. 'text/plain', 'application/pdf')
   * @returns Cleaned plain text suitable for chunking
  */
  parseToCleanText(content: Buffer, mimeType: string): string {
    const normalizedMime =
      mimeType.toLowerCase().split(';', 1).at(0)?.trim() ?? '';

    let rawText: string;

    if (DocumentParseService.TEXT_MIME_TYPES.has(normalizedMime)) {
      rawText = content.toString('utf-8');
    } else if (normalizedMime === 'application/json') {
      try {
        const parsed = JSON.parse(content.toString('utf-8'));
        rawText = JSON.stringify(parsed, null, 2);
      } catch {
        this.logger.warn('Failed to parse JSON content, treating as raw text');
        rawText = content.toString('utf-8');
      }
    } else if (normalizedMime === 'application/pdf') {
      // PDF parsing requires pdf-parse or similar library.
      // For now, log a warning and return empty string.
      this.logger.warn(
        'PDF parsing not yet implemented — install pdf-parse for PDF support. ' +
        'Returning empty text.',
      );
      rawText = '';
    } else {
      this.logger.warn(
        `Unsupported MIME type: ${normalizedMime}. Attempting UTF-8 decode.`,
      );
      rawText = content.toString('utf-8');
    }

    return this.textCleaning.clean(rawText);
  }
}
