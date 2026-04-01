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
  });

  it('includes HTML structure in output', async () => {
    const result = await service.markdownToPdf('# Test Report');
    const html = result.toString('utf-8');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<h1>Test Report</h1>');
  });

  it('uses custom title in head', async () => {
    const result = await service.markdownToPdf('content', {
      title: 'Risk Assessment',
    });
    const html = result.toString('utf-8');
    expect(html).toContain('<title>Risk Assessment</title>');
  });

  it('converts bold and italic', async () => {
    const result = await service.markdownToPdf('**bold** and *italic*');
    const html = result.toString('utf-8');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
  });

  it('converts code blocks', async () => {
    const result = await service.markdownToPdf('```js\nconst x = 1;\n```');
    const html = result.toString('utf-8');
    expect(html).toContain('<pre><code>');
    expect(html).toContain('const x = 1;');
  });

  it('converts inline code', async () => {
    const result = await service.markdownToPdf('Use `ticker` param');
    const html = result.toString('utf-8');
    expect(html).toContain('<code>ticker</code>');
  });

  it('converts blockquotes', async () => {
    const result = await service.markdownToPdf('> Important note');
    const html = result.toString('utf-8');
    expect(html).toContain('<blockquote>Important note</blockquote>');
  });

  it('includes print-friendly CSS', async () => {
    const result = await service.markdownToPdf('# Report');
    const html = result.toString('utf-8');
    expect(html).toContain('@page');
    expect(html).toContain('font-family');
  });

  it('escapes HTML in title', async () => {
    const result = await service.markdownToPdf('content', {
      title: '<script>alert("xss")</script>',
    });
    const html = result.toString('utf-8');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('handles empty markdown', async () => {
    const result = await service.markdownToPdf('');
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
  });
});
