import { describe, it, expect, beforeEach } from 'vitest';
import { PdfService } from '../pdf.service';

describe('PdfService', () => {
  let service: PdfService;

  beforeEach(() => {
    service = new PdfService();
  });

  it('converts simple markdown to buffer', async () => {
    const result = await service.markdownToPdf('# Hello\n\nWorld');
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
    expect(result.toString('utf-8', 0, 8)).toContain('%PDF-1.4');
  });

  it('renders a real PDF instead of HTML', async () => {
    const result = await service.markdownToPdf('# Test Report');
    const pdf = result.toString('utf-8');
    expect(pdf).toContain('%PDF-1.4');
    expect(pdf).toContain('/Type /Catalog');
    expect(pdf).toContain('Test Report');
  });

  it('uses custom title in PDF content', async () => {
    const result = await service.markdownToPdf('content', {
      title: 'Risk Assessment',
    });
    const pdf = result.toString('utf-8');
    expect(pdf).toContain('Risk Assessment');
  });

  it('keeps emphasized text content', async () => {
    const result = await service.markdownToPdf('**bold** and *italic*');
    const pdf = result.toString('utf-8');
    expect(pdf).toContain('bold and italic');
  });

  it('keeps code block text', async () => {
    const result = await service.markdownToPdf('```js\nconst x = 1;\n```');
    const pdf = result.toString('utf-8');
    expect(pdf).toContain('const x = 1;');
  });

  it('keeps inline code text', async () => {
    const result = await service.markdownToPdf('Use `ticker` param');
    const pdf = result.toString('utf-8');
    expect(pdf).toContain('Use ticker param');
  });

  it('keeps blockquote text', async () => {
    const result = await service.markdownToPdf('> Important note');
    const pdf = result.toString('utf-8');
    expect(pdf).toContain('Important note');
  });

  it('includes PDF page metadata', async () => {
    const result = await service.markdownToPdf('# Report');
    const pdf = result.toString('utf-8');
    expect(pdf).toContain('/Type /Page');
    expect(pdf).toContain('/BaseFont /Helvetica');
  });

  it('escapes PDF control characters in content', async () => {
    const result = await service.markdownToPdf('content', {
      title: '(alert) \\ path',
    });
    const pdf = result.toString('utf-8');
    expect(pdf).toContain('\\(alert\\) \\\\ path');
  });

  it('handles empty markdown', async () => {
    const result = await service.markdownToPdf('');
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
  });
});
