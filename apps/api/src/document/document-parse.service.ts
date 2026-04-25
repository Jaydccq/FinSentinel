import { Injectable, Logger, Optional } from '@nestjs/common';
import { TextCleaningService } from './text-cleaning.service';
import { ParserSidecarClient } from './parser-sidecar.client';

/**
 * Document parsing service -- converts raw file content to plain text.
 *
 * Supported formats for parseToCleanText:
 * - text/plain, text/markdown, text/csv, text/html — direct UTF-8 decode
 * - application/json — JSON.stringify with indentation
 * - application/pdf, application/msword, application/vnd...docx — throws USE_ASYNC_PARSER_PATH;
 *   callers must use parseToMarkdown() instead (delegates to ParserSidecarClient).
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

  private static readonly SIDECAR_MIME_TYPES = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ]);

  constructor(
    private readonly textCleaning: TextCleaningService,
    @Optional() private readonly parserSidecar?: ParserSidecarClient,
  ) {}

  /**
   * Parse raw file content to cleaned plain text.
   *
   * For PDF/DOC/DOCX, throws Error('USE_ASYNC_PARSER_PATH') — call parseToMarkdown() instead.
   *
   * @param content - File content as a Buffer
   * @param mimeType - MIME type of the file (e.g. 'text/plain', 'application/json')
   * @returns Cleaned plain text suitable for chunking
   */
  parseToCleanText(content: Buffer, mimeType: string): string {
    const normalizedMime = mimeType.toLowerCase().split(';', 1).at(0)?.trim() ?? '';

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
    } else if (DocumentParseService.SIDECAR_MIME_TYPES.has(normalizedMime)) {
      throw new Error('USE_ASYNC_PARSER_PATH');
    } else {
      this.logger.warn(`Unsupported MIME type: ${normalizedMime}. Attempting UTF-8 decode.`);
      rawText = content.toString('utf-8');
    }

    return this.textCleaning.clean(rawText);
  }

  /**
   * Parse a PDF, DOC, or DOCX buffer by delegating to the parser sidecar.
   *
   * @param content  - File content as a Buffer
   * @param mimeType - MIME type (must be a SIDECAR_MIME_TYPE)
   * @param fileName - Original file name (used for FormData upload to sidecar)
   * @returns Cleaned markdown text suitable for chunking
   * @throws Error('PARSER_SIDECAR_UNAVAILABLE') if no sidecar is injected
   */
  async parseToMarkdown(content: Buffer, mimeType: string, fileName: string): Promise<string> {
    if (!this.parserSidecar) {
      throw new Error('PARSER_SIDECAR_UNAVAILABLE');
    }
    const result = await this.parserSidecar.parse(content, mimeType, fileName);
    return this.textCleaning.clean(result.markdown);
  }

  /**
   * Parse a PDF, DOC, or DOCX buffer by delegating to the parser sidecar,
   * returning the cleaned markdown together with the full sidecar metadata.
   *
   * R5.6: callers that need parser-origin metadata (pageCount, parserVersion,
   * sourceMimeType) should use this method instead of parseToMarkdown.
   *
   * @param content  - File content as a Buffer
   * @param mimeType - MIME type (must be a SIDECAR_MIME_TYPE)
   * @param fileName - Original file name (used for FormData upload to sidecar)
   * @returns Object with cleaned markdown and parser metadata fields
   * @throws Error('PARSER_SIDECAR_UNAVAILABLE') if no sidecar is injected
   */
  async parseToMarkdownWithMetadata(
    content: Buffer,
    mimeType: string,
    fileName: string,
  ): Promise<{
    markdown: string;
    pageCount: number;
    parserVersion: string;
    sourceMimeType: string;
  }> {
    if (!this.parserSidecar) {
      throw new Error('PARSER_SIDECAR_UNAVAILABLE');
    }
    const result = await this.parserSidecar.parse(content, mimeType, fileName);
    return {
      markdown: this.textCleaning.clean(result.markdown),
      pageCount: result.metadata.pageCount,
      parserVersion: result.metadata.parserVersion,
      sourceMimeType: result.metadata.sourceMimeType,
    };
  }
}
