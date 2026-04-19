import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';
import type { RerankedCandidate } from './rerank.service';

export interface ContextExpansionOptions {
  neighborChunks?: number;
  fetchParentSection?: boolean;
}

interface ExpandedChunkRow {
  id: string;
  source_id: string;
  chunk_index: number;
  content: string;
  metadata: Record<string, unknown>;
  meta_title: string | null;
  section_path: string | null;
  parent_id: string | null;
}

@Injectable()
export class ContextExpanderService {
  private readonly enabled: boolean;
  private readonly topN: number;

  constructor(
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
    configService: ConfigService,
  ) {
    this.enabled = configService.get<string>('RAG_CONTEXT_EXPANSION_ENABLED', 'false') === 'true';
    this.topN = configService.get<number>('RAG_CONTEXT_EXPANSION_TOP_N', 10);
  }

  async expand(
    topReranked: RerankedCandidate[],
    options: ContextExpansionOptions = {},
  ): Promise<RerankedCandidate[]> {
    if (!this.enabled) {
      return topReranked;
    }

    const W = options.neighborChunks ?? 1;
    const candidates = topReranked.slice(0, this.topN);
    const rest = topReranked.slice(this.topN);

    const seenIds = new Set(topReranked.map((c) => c.chunkId));
    const expanded: RerankedCandidate[] = [];

    for (const candidate of candidates) {
      const sectionPath =
        typeof candidate.metadata['section_path'] === 'string'
          ? candidate.metadata['section_path']
          : null;

      const chunkIndex =
        typeof candidate.metadata['chunk_index'] === 'number'
          ? candidate.metadata['chunk_index']
          : null;

      if (chunkIndex === null) {
        // Cannot expand without a known chunk_index
        continue;
      }

      let rows: ExpandedChunkRow[];
      const useSectionPath = sectionPath !== null && options.fetchParentSection !== false;
      try {
        if (useSectionPath) {
          rows = await this.queryWithSectionPath(
            candidate.sourceId,
            sectionPath,
            chunkIndex,
            W,
            candidate.chunkId,
          );
        } else {
          rows = await this.queryNeighborOnly(
            candidate.sourceId,
            chunkIndex,
            W,
            candidate.chunkId,
          );
        }
      } catch {
        continue;
      }

      for (const row of rows) {
        if (seenIds.has(row.id)) continue;
        seenIds.add(row.id);
        expanded.push({
          ...candidate,
          chunkId: row.id,
          sourceId: row.source_id,
          content: row.content,
          metadata: {
            ...row.metadata,
            meta_title: row.meta_title ?? undefined,
            section_path: row.section_path ?? undefined,
            chunk_index: row.chunk_index,
          },
          rerankScore: candidate.rerankScore * 0.75,
          fallbackReason: candidate.fallbackReason,
        });
      }
    }

    // Original candidates first, then expansions in document order, then rest
    return [...candidates, ...expanded, ...rest];
  }

  private async queryWithSectionPath(
    sourceId: string,
    sectionPath: string,
    chunkIndex: number,
    W: number,
    excludeId: string,
  ): Promise<ExpandedChunkRow[]> {
    const rows = await this.db.execute(sql`
      SELECT id, source_id, chunk_index, content, metadata, meta_title, section_path, parent_id
      FROM document_chunks
      WHERE source_id = ${sourceId}
        AND section_path LIKE ${sectionPath + '%'}
        AND chunk_index BETWEEN ${chunkIndex - W} AND ${chunkIndex + W}
        AND id != ${excludeId}
      ORDER BY chunk_index
      LIMIT 5
    `);
    return rows as unknown as ExpandedChunkRow[];
  }

  private async queryNeighborOnly(
    sourceId: string,
    chunkIndex: number,
    W: number,
    excludeId: string,
  ): Promise<ExpandedChunkRow[]> {
    const rows = await this.db.execute(sql`
      SELECT id, source_id, chunk_index, content, metadata, meta_title, section_path, parent_id
      FROM document_chunks
      WHERE source_id = ${sourceId}
        AND chunk_index BETWEEN ${chunkIndex - W} AND ${chunkIndex + W}
        AND id != ${excludeId}
      ORDER BY chunk_index
      LIMIT 5
    `);
    return rows as unknown as ExpandedChunkRow[];
  }
}
