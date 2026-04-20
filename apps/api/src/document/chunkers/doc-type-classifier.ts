import type { StructuredDocument } from '../structured-document';

export type ClassifiedDocType = 'report' | 'qa' | 'table_heavy' | 'default';

const QUESTION_LINE_RE = /(^|\n)(?:Q\s*[:.]?|Question\s*[:.]?)\s*/i;

export function classifyDocType(doc: StructuredDocument): ClassifiedDocType {
  const total = doc.chunks.length || 1;
  const tables = doc.chunks.filter(c => c.modality === 'table').length;
  if (tables / total >= 0.4) return 'table_heavy';

  const textBlob = doc.chunks.filter(c => c.modality === 'text').map(c => c.text).join('\n');
  const lines = textBlob.split(/\n+/).filter(l => l.trim().length > 0);
  const questions = lines.filter(l => QUESTION_LINE_RE.test(l)).length;
  if (lines.length > 0 && questions / lines.length >= 0.2) return 'qa';

  const distinctSections = new Set<string>();
  for (const c of doc.chunks) {
    if (c.sectionPath.length > 0) distinctSections.add(c.sectionPath.join(' / '));
  }
  if (distinctSections.size >= 3) return 'report';

  return 'default';
}
