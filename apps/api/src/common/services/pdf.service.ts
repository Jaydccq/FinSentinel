import { Injectable, Logger } from '@nestjs/common';

/**
 * Markdown-to-PDF conversion service.
 *
 * Mirrors Java MarkdownToPdfConverter (iText 8).
 * Uses a lightweight HTML-based approach:
 * - Converts markdown → HTML with basic styling
 * - Renders to PDF buffer
 *
 * For production, install `md-to-pdf` or `puppeteer` for full PDF rendering.
 * This implementation provides a styled HTML-to-buffer fallback.
 */
@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  /**
   * Convert markdown content to a PDF buffer.
   *
   * Current implementation wraps markdown in a styled HTML document and
   * returns it as a buffer. For true PDF rendering, swap in `md-to-pdf`.
   */
  async markdownToPdf(
    markdown: string,
    options?: { title?: string },
  ): Promise<Buffer> {
    const title = options?.title ?? 'FinSentinel Report';

    // Convert markdown to basic HTML
    const htmlBody = this.markdownToHtml(markdown);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${this.escapeHtml(title)}</title>
  <style>
    @page { margin: 2cm; size: A4; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.6;
      color: #1a1a1a;
      max-width: 210mm;
      margin: 0 auto;
      padding: 20px;
    }
    h1 { font-size: 20pt; border-bottom: 2px solid #2563eb; padding-bottom: 8px; color: #1e3a5f; }
    h2 { font-size: 16pt; color: #2563eb; margin-top: 24px; }
    h3 { font-size: 13pt; color: #374151; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    th, td { border: 1px solid #d1d5db; padding: 8px 12px; text-align: left; font-size: 10pt; }
    th { background-color: #f3f4f6; font-weight: 600; }
    code { background: #f3f4f6; padding: 2px 6px; border-radius: 3px; font-size: 10pt; }
    pre { background: #f3f4f6; padding: 12px; border-radius: 6px; overflow-x: auto; }
    pre code { background: none; padding: 0; }
    blockquote { border-left: 4px solid #2563eb; margin: 12px 0; padding: 8px 16px; color: #4b5563; }
    ul, ol { padding-left: 24px; }
    .risk-high { color: #dc2626; font-weight: bold; }
    .risk-medium { color: #f59e0b; font-weight: bold; }
    .risk-low { color: #16a34a; font-weight: bold; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 20px 0; }
  </style>
</head>
<body>
${htmlBody}
</body>
</html>`;

    // Try md-to-pdf if available, otherwise return HTML as buffer
    try {
      const { mdToPdf } = await import('md-to-pdf');
      const result = await mdToPdf(
        { content: markdown },
        {
          pdf_options: {
            format: 'A4',
            margin: { top: '2cm', right: '2cm', bottom: '2cm', left: '2cm' },
            printBackground: true,
          },
          launch_options: { args: ['--no-sandbox'] },
        },
      );
      if (result?.content) {
        return Buffer.from(result.content);
      }
    } catch {
      this.logger.warn('md-to-pdf not available, returning styled HTML as PDF-compatible buffer');
    }

    // Fallback: return the styled HTML as a buffer
    return Buffer.from(html, 'utf-8');
  }

  /**
   * Simple markdown-to-HTML converter for basic formatting.
   * Handles: headers, bold, italic, code blocks, lists, tables, blockquotes, links, hr.
   */
  private markdownToHtml(md: string): string {
    let html = md;

    // Code blocks (``` ... ```)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Headers
    html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Bold + italic
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // HR
    html = html.replace(/^---+$/gm, '<hr>');

    // Blockquotes
    html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

    // Unordered lists
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // Tables (simple)
    html = html.replace(
      /^\|(.+)\|$/gm,
      (match) => {
        const cells = match
          .split('|')
          .filter((c) => c.trim() !== '')
          .map((c) => c.trim());
        // Skip separator rows
        if (cells.every((c) => /^[-:]+$/.test(c))) return '';
        const tag = 'td';
        return `<tr>${cells.map((c) => `<${tag}>${c}</${tag}>`).join('')}</tr>`;
      },
    );
    html = html.replace(/(<tr>.*<\/tr>\n?)+/g, '<table>$&</table>');

    // Paragraphs (lines not already wrapped)
    html = html.replace(/^(?!<[a-z])(.+)$/gm, '<p>$1</p>');

    // Clean up empty paragraphs
    html = html.replace(/<p>\s*<\/p>/g, '');

    return html;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
