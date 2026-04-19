import { Injectable } from '@nestjs/common';
import type { StructuredChunk, StructuredDocument } from './structured-document';

type MdBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'fence'; text: string }
  | { kind: 'table'; text: string }
  | { kind: 'paragraph'; text: string };

/**
 * Parses Markdown text into a structured document: a heading tree with per-section
 * text blocks. Non-markdown input (no headings detected) returns a single root
 * section with the whole text.
 *
 * Supported heading syntax:
 * - ATX headings: `# `, `## `, `### `, `#### `, `##### `, `###### `
 * - Setext headings: a paragraph line followed by `===...` (H1) or `---...` (H2)
 *
 * Block types:
 * - Fenced code blocks (``` or ~~~): grouped verbatim, modality 'text'.
 * - Table blocks (lines starting with `|` including a separator row): grouped
 *   as one chunk with modality 'table'.
 * - All other lines: plain paragraph text with modality 'text'.
 *
 * pageStart / pageEnd are always null because Markdown has no page concept.
 * parentId is always null at parse time; it is set downstream.
 */
@Injectable()
export class MarkdownStructureService {
  private static readonly ATX_HEADING = /^(#{1,6})\s+(.*?)\s*$/;
  private static readonly SETEXT_H1 = /^=+\s*$/;
  private static readonly SETEXT_H2 = /^-+\s*$/;
  private static readonly FENCE_OPEN = /^(```|~~~)/;
  private static readonly TABLE_ROW = /^\|/;
  private static readonly TABLE_SEP = /^\|[\s|:-]+\|?\s*$/;

  /**
   * Parse a markdown string into a StructuredDocument.
   *
   * Non-markdown input (no ATX or setext headings found) returns a single
   * 'text' chunk with empty sectionPath and null title.
   */
  parse(markdown: string): StructuredDocument {
    if (!markdown || markdown.trim().length === 0) {
      return { chunks: [], sourceFormat: 'plain' };
    }

    const lines = markdown.split('\n');
    const blocks = this.splitIntoBlocks(lines);
    const chunks = this.buildChunks(blocks);
    const hasHeadings = chunks.some((c) => c.sectionPath.length > 0);

    return {
      chunks,
      sourceFormat: hasHeadings ? 'markdown' : 'plain',
    };
  }

  // ── Phase 1: split raw lines into logical blocks ──────────────────────────

  private splitIntoBlocks(lines: string[]): MdBlock[] {
    const blocks: MdBlock[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i]!;

      // Fenced code block
      if (MarkdownStructureService.FENCE_OPEN.test(line)) {
        const fence = line.match(MarkdownStructureService.FENCE_OPEN)![0]!;
        // Escape special regex chars in the fence marker (backticks and tildes are safe but be explicit)
        const escapedFence = fence.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const closePattern = new RegExp(`^${escapedFence}`);
        const fenceLines: string[] = [line];
        i++;
        while (i < lines.length) {
          fenceLines.push(lines[i]!);
          if (closePattern.test(lines[i]!) && lines[i] !== line) {
            i++;
            break;
          }
          i++;
        }
        blocks.push({ kind: 'fence', text: fenceLines.join('\n') });
        continue;
      }

      // ATX heading
      const atxMatch = line.match(MarkdownStructureService.ATX_HEADING);
      if (atxMatch) {
        blocks.push({ kind: 'heading', level: atxMatch[1]!.length, text: atxMatch[2]! });
        i++;
        continue;
      }

      // Setext heading (look ahead at the next line)
      if (line.trim().length > 0 && i + 1 < lines.length) {
        const next = lines[i + 1]!.trim();
        if (next.length >= 1 && MarkdownStructureService.SETEXT_H1.test(next)) {
          blocks.push({ kind: 'heading', level: 1, text: line.trim() });
          i += 2;
          continue;
        }
        if (next.length >= 2 && MarkdownStructureService.SETEXT_H2.test(next)) {
          blocks.push({ kind: 'heading', level: 2, text: line.trim() });
          i += 2;
          continue;
        }
      }

      // Table: collect consecutive table rows
      if (MarkdownStructureService.TABLE_ROW.test(line)) {
        const tableLines: string[] = [line];
        i++;
        while (i < lines.length && MarkdownStructureService.TABLE_ROW.test(lines[i]!)) {
          tableLines.push(lines[i]!);
          i++;
        }
        // Only treat as a table if a separator row (|---|) is present
        const hasSep = tableLines.some((l) =>
          MarkdownStructureService.TABLE_SEP.test(l),
        );
        if (hasSep) {
          blocks.push({ kind: 'table', text: tableLines.join('\n') });
        } else {
          blocks.push({ kind: 'paragraph', text: tableLines.join('\n') });
        }
        continue;
      }

      // Paragraph: collect non-special lines until blank line or next special block
      const paraLines: string[] = [];
      while (i < lines.length) {
        const l = lines[i]!;
        if (
          MarkdownStructureService.ATX_HEADING.test(l) ||
          MarkdownStructureService.FENCE_OPEN.test(l) ||
          MarkdownStructureService.TABLE_ROW.test(l)
        ) {
          break;
        }
        // Setext heading look-ahead: stop before the text line that is being underlined
        if (
          l.trim().length > 0 &&
          i + 1 < lines.length
        ) {
          const nextTrimmed = lines[i + 1]!.trim();
          if (
            (nextTrimmed.length >= 1 && MarkdownStructureService.SETEXT_H1.test(nextTrimmed)) ||
            (nextTrimmed.length >= 2 && MarkdownStructureService.SETEXT_H2.test(nextTrimmed))
          ) {
            break;
          }
        }
        paraLines.push(l);
        i++;
      }
      const paraText = paraLines.join('\n').trim();
      if (paraText) {
        blocks.push({ kind: 'paragraph', text: paraText });
      }
    }

    return blocks;
  }

  // ── Phase 2: walk blocks and build StructuredChunks ───────────────────────

  private buildChunks(blocks: MdBlock[]): StructuredChunk[] {
    const chunks: StructuredChunk[] = [];
    // sectionStack[i] = heading text at depth i (0-indexed, so level 1 = index 0)
    const sectionStack: string[] = [];

    for (const block of blocks) {
      if (block.kind === 'heading') {
        // Pop stack entries at or deeper than this level
        const depth = block.level - 1; // 0-indexed
        sectionStack.splice(depth);
        sectionStack.push(block.text);
        continue;
      }

      const sectionPath = [...sectionStack];
      const title = sectionStack.length > 0 ? sectionStack[sectionStack.length - 1]! : null;

      if (block.kind === 'fence') {
        chunks.push({
          text: block.text,
          title,
          sectionPath,
          parentId: null,
          modality: 'text',
          pageStart: null,
          pageEnd: null,
        });
        continue;
      }

      if (block.kind === 'table') {
        chunks.push({
          text: block.text,
          title,
          sectionPath,
          parentId: null,
          modality: 'table',
          pageStart: null,
          pageEnd: null,
        });
        continue;
      }

      // paragraph
      if (block.text.trim()) {
        chunks.push({
          text: block.text.trim(),
          title,
          sectionPath,
          parentId: null,
          modality: 'text',
          pageStart: null,
          pageEnd: null,
        });
      }
    }

    return chunks;
  }
}
