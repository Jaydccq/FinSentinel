import { Injectable, Logger } from '@nestjs/common';

/**
 * Markdown-to-PDF conversion service.
 *
 * Dependency-free markdown-to-PDF renderer for generated reports.
 * The output is a real PDF buffer, not HTML masquerading as a PDF.
 */
@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);
  private static readonly PAGE_WIDTH = 595;
  private static readonly PAGE_HEIGHT = 842;
  private static readonly LEFT_MARGIN = 50;
  private static readonly TOP_MARGIN = 792;
  private static readonly LINE_HEIGHT = 14;
  private static readonly MAX_CHARS_PER_LINE = 88;
  private static readonly MAX_LINES_PER_PAGE = 48;

  /**
   * Convert markdown content to a PDF buffer.
   *
   * Converts markdown into a simple, text-forward PDF document.
   */
  async markdownToPdf(markdown: string, options?: { title?: string }): Promise<Buffer> {
    const title = options?.title ?? 'FinSentinel Report';
    const lines = this.wrapLines([title, '', ...this.markdownToPlainText(markdown)]);

    if (lines.length === 0) {
      lines.push(title);
    }

    const pdf = this.renderPdf(lines);
    this.logger.debug(`Rendered PDF "${title}" with ${lines.length} lines`);
    return pdf;
  }

  private markdownToPlainText(markdown: string): string[] {
    const normalized = markdown
      .replace(/\r\n/g, '\n')
      .replace(/```[\w-]*\n([\s\S]*?)```/g, (_, code: string) => `${code.trim()}\n`)
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^>\s?/gm, '')
      .replace(/^\s*[-*]\s+/gm, '• ')
      .replace(/^\s*\d+\.\s+/gm, '• ')
      .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/^---+$/gm, '')
      .replace(/\|/g, ' | ');

    return normalized
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line, index, arr) => line.length > 0 || arr[index - 1] !== '');
  }

  private wrapLines(lines: string[]): string[] {
    const wrapped: string[] = [];

    for (const rawLine of lines) {
      if (rawLine.length === 0) {
        wrapped.push('');
        continue;
      }

      let remaining = rawLine;
      while (remaining.length > PdfService.MAX_CHARS_PER_LINE) {
        const splitAt = remaining.lastIndexOf(' ', PdfService.MAX_CHARS_PER_LINE);
        const safeSplitAt =
          splitAt > Math.floor(PdfService.MAX_CHARS_PER_LINE / 2)
            ? splitAt
            : PdfService.MAX_CHARS_PER_LINE;
        wrapped.push(remaining.slice(0, safeSplitAt).trimEnd());
        remaining = remaining.slice(safeSplitAt).trimStart();
      }
      wrapped.push(remaining);
    }

    return wrapped;
  }

  private renderPdf(lines: string[]): Buffer {
    const pages = this.chunkLines(lines, PdfService.MAX_LINES_PER_PAGE);
    const objects: string[] = [];

    const reserveObject = () => {
      objects.push('');
      return objects.length;
    };

    const setObject = (index: number, content: string) => {
      objects[index - 1] = `${index} 0 obj\n${content}\nendobj\n`;
    };

    const catalogId = reserveObject();
    const pagesId = reserveObject();
    const fontId = reserveObject();
    const pageIds: number[] = [];

    for (const pageLines of pages) {
      const contentId = reserveObject();
      const pageId = reserveObject();
      const stream = this.buildPageStream(pageLines);

      setObject(
        contentId,
        `<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`,
      );
      setObject(
        pageId,
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PdfService.PAGE_WIDTH} ${PdfService.PAGE_HEIGHT}] ` +
          `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
      );
      pageIds.push(pageId);
    }

    setObject(
      pagesId,
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`,
    );
    setObject(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    setObject(fontId, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    for (const object of objects) {
      offsets.push(Buffer.byteLength(pdf, 'utf8'));
      pdf += object;
    }

    const xrefOffset = Buffer.byteLength(pdf, 'utf8');
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';

    for (let i = 1; i < offsets.length; i++) {
      pdf += `${offsets[i]!.toString().padStart(10, '0')} 00000 n \n`;
    }

    pdf +=
      `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\n` +
      `startxref\n${xrefOffset}\n%%EOF`;

    return Buffer.from(pdf, 'utf8');
  }

  private chunkLines(lines: string[], size: number): string[][] {
    const pages: string[][] = [];
    for (let index = 0; index < lines.length; index += size) {
      pages.push(lines.slice(index, index + size));
    }
    return pages.length > 0 ? pages : [['']];
  }

  private buildPageStream(lines: string[]): string {
    const contentLines = [
      'BT',
      '/F1 12 Tf',
      `${PdfService.LEFT_MARGIN} ${PdfService.TOP_MARGIN} Td`,
      `${PdfService.LINE_HEIGHT} TL`,
    ];

    for (const line of lines) {
      contentLines.push(`(${this.escapePdfText(line)}) Tj`);
      contentLines.push('T*');
    }

    contentLines.push('ET');
    return contentLines.join('\n');
  }

  private escapePdfText(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }
}
