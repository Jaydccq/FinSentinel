import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import { contextJournalEntries } from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';
import type {
  AnalysisStageKey,
  ContextJournalEntryType,
  SharedContext,
  StageInputSnapshot,
} from '@finsentinel/shared';
import { stageInputSnapshotSchema } from '@finsentinel/shared';

interface AppendJournalEntryArgs {
  userId: string;
  entryType: ContextJournalEntryType;
  sourceType: string;
  sourceRef?: string;
  sessionId?: string;
  runId?: string;
  stageKey?: AnalysisStageKey;
  roleKey?: string;
  payload?: Record<string, unknown>;
}

interface CompactionSummaryArgs {
  userId: string;
  sessionId: string;
  payload: {
    summaryText: string;
    compactedMessageCount: number;
  };
}

interface StageInputArgs {
  userId: string;
  runId: string;
  stageKey: AnalysisStageKey;
  roleKey?: string;
  payload: StageInputSnapshot;
}

type JournalRow = {
  id: string;
  userId: string;
  runId: string | null;
  stageKey: AnalysisStageKey | null;
  entryType: ContextJournalEntryType;
  sourceType: string;
  sourceRef: string | null;
  payloadJson: Record<string, unknown>;
  createdAt: Date;
};

@Injectable()
export class ContextJournalService {
  private readonly logger = new Logger(ContextJournalService.name);

  constructor(@Inject('DRIZZLE_DB') private readonly db: DrizzleDB) {}

  async append(args: AppendJournalEntryArgs): Promise<JournalRow | null> {
    const now = new Date();
    // Supply id + createdAt explicitly to avoid the Drizzle+postgres.js
    // mixed-default bind bug when defaulted columns are mixed with bound args.
    const [created] = await this.db
      .insert(contextJournalEntries)
      .values({
        id: randomUUID(),
        userId: args.userId,
        sessionId: args.sessionId ?? null,
        runId: args.runId ?? null,
        stageKey: args.stageKey ?? null,
        roleKey: args.roleKey ?? null,
        entryType: args.entryType,
        sourceType: args.sourceType,
        sourceRef: args.sourceRef ?? null,
        payloadJson: args.payload ?? {},
        createdAt: now,
      })
      .returning();

    return (created as JournalRow | undefined) ?? null;
  }

  async appendCompactionSummary(args: CompactionSummaryArgs): Promise<JournalRow | null> {
    return this.append({
      userId: args.userId,
      sessionId: args.sessionId,
      entryType: 'COMPACTION_SUMMARY',
      sourceType: 'CHAT',
      sourceRef: `chat_session_memories/${args.sessionId}`,
      payload: args.payload,
    });
  }

  async appendStageInput(args: StageInputArgs): Promise<JournalRow | null> {
    return this.append({
      userId: args.userId,
      runId: args.runId,
      stageKey: args.stageKey,
      roleKey: args.roleKey,
      entryType: 'STAGE_INPUT',
      sourceType: 'RUN',
      sourceRef: `analysis_runs/${args.runId}`,
      payload: args.payload,
    });
  }

  async getRunContext(userId: string, runId: string): Promise<SharedContext> {
    const runRows = await this.selectRunRows(userId, runId);
    const latestStageInput = this.findLatestStageInput(runRows);
    const referenceIds = this.getReferencedEntryIds(latestStageInput);
    const referencedRows = referenceIds.length > 0 ? await this.selectRowsByIds(userId, referenceIds) : [];
    const rows = this.mergeRows(runRows, referencedRows);
    const hasStageInput = latestStageInput !== null;
    const contextEntryIds = this.getStringArray(latestStageInput?.payloadJson.contextEntryIds);
    const evidenceEntryIds = this.getStringArray(latestStageInput?.payloadJson.evidenceEntryIds);
    const compactionRows = hasStageInput
      ? this.filterReferencedRows(rows, 'COMPACTION_SUMMARY', contextEntryIds)
      : this.filterByType(rows, 'COMPACTION_SUMMARY');
    const retrievalRows = hasStageInput
      ? this.filterReferencedRows(rows, 'RAG_EVIDENCE', evidenceEntryIds)
      : this.filterByType(rows, 'RAG_EVIDENCE');

    return {
      longTermPreferenceContext: this.emptyLayer(),
      midTermStrategyContext: this.emptyLayer(),
      shortTermSessionContext: this.layerFromRows(compactionRows, ['summaryText']),
      retrievalContext: this.layerFromRows(retrievalRows, ['summary', 'snippet', 'text']),
    };
  }

  async getStageInput(
    userId: string,
    runId: string,
    stageKey: AnalysisStageKey,
  ): Promise<StageInputSnapshot | null> {
    const [row] = await this.db
      .select({
        payloadJson: contextJournalEntries.payloadJson,
      })
      .from(contextJournalEntries)
      .where(
        and(
          eq(contextJournalEntries.userId, userId),
          eq(contextJournalEntries.runId, runId),
          eq(contextJournalEntries.stageKey, stageKey),
          eq(contextJournalEntries.entryType, 'STAGE_INPUT'),
        ),
      )
      .orderBy(desc(contextJournalEntries.createdAt))
      .limit(1);

    return row ? stageInputSnapshotSchema.parse(row.payloadJson) : null;
  }

  private async selectRunRows(userId: string, runId: string): Promise<JournalRow[]> {
    try {
      return (await this.db
        .select()
        .from(contextJournalEntries)
        .where(
          and(
            eq(contextJournalEntries.userId, userId),
            eq(contextJournalEntries.runId, runId),
          ),
        )
        .orderBy(asc(contextJournalEntries.createdAt))) as JournalRow[];
    } catch (error) {
      this.logger.warn(`run context query failed: ${error}`);
      return [];
    }
  }

  private async selectRowsByIds(userId: string, ids: string[]): Promise<JournalRow[]> {
    try {
      return (await this.db
        .select()
        .from(contextJournalEntries)
        .where(
          and(
            eq(contextJournalEntries.userId, userId),
            inArray(contextJournalEntries.id, ids),
          ),
        )
        .orderBy(asc(contextJournalEntries.createdAt))) as JournalRow[];
    } catch (error) {
      this.logger.warn(`referenced context query failed: ${error}`);
      return [];
    }
  }

  private findLatestStageInput(rows: JournalRow[]): JournalRow | null {
    for (let idx = rows.length - 1; idx >= 0; idx -= 1) {
      if (rows[idx]?.entryType === 'STAGE_INPUT') {
        return rows[idx] ?? null;
      }
    }

    return null;
  }

  private getReferencedEntryIds(row: JournalRow | null): string[] {
    if (!row) return [];

    return [
      ...this.getStringArray(row.payloadJson.contextEntryIds),
      ...this.getStringArray(row.payloadJson.evidenceEntryIds),
    ];
  }

  private mergeRows(primaryRows: JournalRow[], secondaryRows: JournalRow[]): JournalRow[] {
    const rowsById = new Map<string, JournalRow>();
    for (const row of [...primaryRows, ...secondaryRows]) {
      rowsById.set(row.id, row);
    }

    return [...rowsById.values()].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }

  private filterReferencedRows(
    rows: JournalRow[],
    entryType: ContextJournalEntryType,
    ids: string[],
  ): JournalRow[] {
    const matches = this.filterByType(rows, entryType);
    if (ids.length === 0) return [];

    const idsSet = new Set(ids);
    return matches.filter((row) => idsSet.has(row.id));
  }

  private filterByType(rows: JournalRow[], entryType: ContextJournalEntryType): JournalRow[] {
    return rows.filter((row) => row.entryType === entryType);
  }

  private layerFromRows(rows: JournalRow[], summaryFields: string[]): SharedContext['shortTermSessionContext'] {
    if (rows.length === 0) {
      return this.emptyLayer();
    }

    const rowSummaries = rows.map((row) => ({
      row,
      summary: this.firstString(row.payloadJson, summaryFields),
    }));
    const summaries = rowSummaries
      .map(({ summary }) => summary)
      .filter((summary): summary is string => summary.length > 0);
    const summary = summaries.join('\n---\n');
    if (!summary) {
      return this.emptyLayer();
    }

    const contributingRows = rowSummaries.filter(({ summary }) => summary.length > 0).map(({ row }) => row);
    const sourceIds = contributingRows.map((row) => row.id);

    return {
      summary,
      sourceIds,
      updatedAt: this.latestCreatedAt(contributingRows),
    };
  }

  private latestCreatedAt(rows: JournalRow[]): string | undefined {
    const latest = rows.reduce<JournalRow | null>((current, candidate) => {
      if (!current || candidate.createdAt > current.createdAt) return candidate;
      return current;
    }, null);

    return latest?.createdAt.toISOString();
  }

  private firstString(payload: Record<string, unknown>, keys: string[]): string {
    for (const key of keys) {
      const value = payload[key];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }

    return '';
  }

  private getStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string');
  }

  private emptyLayer(): SharedContext['shortTermSessionContext'] {
    return { summary: '', sourceIds: [] };
  }
}
