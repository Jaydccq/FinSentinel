import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { rename, writeFile, access } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { agentEvents, chatMessages, documentChunks, sql } from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';
import { aiConfig } from '../../config/ai.config';

// ── Types ─────────────────────────────────────────────────────────────────────

export type QueryClass =
  | 'factoid'
  | 'relational'
  | 'summary'
  | 'numeric'
  | 'navigational'
  | 'unknown';

export interface GoldenCandidateEntry {
  id: string;
  query: string;
  query_class: QueryClass;
  expected_chunk_ids: string[];
  acceptable_chunk_ids: string[];
  expected_source_docs: string[];
  expected_answer: string;
  expected_entities: string[];
  difficulty: string;
  tags: string[];
  notes: string;
  source_provenance: {
    source: 'chat_messages' | 'agent_events' | 'reverse_from_chunk';
    source_row_id: string;
    source_chunk_id?: string;
  };
}

export interface BuildDraftArgs {
  limitChat?: number;
  limitEvents?: number;
  limitReverse?: number;
  outputPath: string;
  dryRun?: boolean;
}

/** Options forwarded to {@link GoldenCandidatesService.fromChunkReverse}. */
export interface FromChunkReverseOptions {
  dryRun?: boolean;
}

/**
 * Adapter interface for LLM text generation used by reverse-Q synthesis.
 * Injected via the GOLDEN_LLM_CLIENT token so tests can swap it out
 * without touching the ai-runtime internals.
 */
export interface LlmTextClient {
  generate(systemPrompt: string, userPrompt: string): Promise<string>;
}

export const GOLDEN_LLM_CLIENT = 'GOLDEN_LLM_CLIENT';

// Canonical query classes for LLM response normalisation
const CANONICAL_CLASSES = new Set<QueryClass>([
  'factoid',
  'relational',
  'summary',
  'numeric',
  'navigational',
]);

const RETRIEVAL_AGGREGATE_TYPES = ['CHAT_SESSION', 'AGENT_BRAIN'] as const;

// CHAT_MESSAGE_PERSISTED carries the user message text in payload_json.
// We also accept TOOL_CALLED in case future payloads carry a query field.
const RETRIEVAL_EVENT_TYPES = ['CHAT_MESSAGE_PERSISTED', 'TOOL_CALLED'] as const;

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class GoldenCandidatesService {
  private readonly logger = new Logger(GoldenCandidatesService.name);
  private readonly aiCfg: ConfigType<typeof aiConfig>;

  constructor(
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
    @Inject(aiConfig.KEY) aiCfgValue: ConfigType<typeof aiConfig>,
    @Inject(GOLDEN_LLM_CLIENT) private readonly llm: LlmTextClient,
    private readonly configService: ConfigService,
  ) {
    this.aiCfg = aiCfgValue;
  }

  // ── Source: chat_messages ─────────────────────────────────────────────────

  /**
   * Pull recent user-role messages and produce candidates.
   * Deduplicates on trimmed content; filters out < 5 or > 200 char messages.
   */
  async fromChatMessages(limit: number): Promise<GoldenCandidateEntry[]> {
    const rows = await this.db
      .select({
        id: chatMessages.id,
        content: chatMessages.content,
        role: chatMessages.role,
      })
      .from(chatMessages)
      .where(sql`${chatMessages.role} = 'user'`)
      .orderBy(sql`${chatMessages.createdAt} DESC`)
      .limit(limit * 4); // over-fetch to allow dedup + length filtering

    const seen = new Set<string>();
    const entries: GoldenCandidateEntry[] = [];

    for (const row of rows) {
      if (entries.length >= limit) break;

      const query = (row.content ?? '').trim();
      if (query.length < 5 || query.length > 200) continue;
      if (seen.has(query)) continue;

      seen.add(query);
      entries.push(this.makeEntry('chat', row.id, query, 'unknown', 'chat_messages'));
    }

    return entries;
  }

  // ── Source: agent_events ──────────────────────────────────────────────────

  /**
   * Extract query text from agent_events payloads.
   * Only events where aggregate_type is CHAT_SESSION or AGENT_BRAIN
   * AND event_type is one of the retrieval-relevant types are considered.
   * Entries without payload_json.query are silently skipped.
   */
  async fromAgentEvents(limit: number): Promise<GoldenCandidateEntry[]> {
    const aggregateFilter = sql`${agentEvents.aggregateType} IN ('CHAT_SESSION', 'AGENT_BRAIN')`;
    const eventTypeFilter = sql`${agentEvents.eventType} IN ('CHAT_MESSAGE_PERSISTED', 'TOOL_CALLED')`;

    const rows = await this.db
      .select({
        id: agentEvents.id,
        payloadJson: agentEvents.payloadJson,
      })
      .from(agentEvents)
      .where(sql`${aggregateFilter} AND ${eventTypeFilter}`)
      .orderBy(sql`${agentEvents.createdAt} DESC`)
      .limit(limit * 4);

    const seen = new Set<string>();
    const entries: GoldenCandidateEntry[] = [];

    for (const row of rows) {
      if (entries.length >= limit) break;

      const payload = row.payloadJson as Record<string, unknown> | null;
      if (!payload) continue;

      const rawQuery = payload['query'];
      if (typeof rawQuery !== 'string' || !rawQuery.trim()) continue;

      const query = rawQuery.trim();
      if (query.length < 5 || query.length > 200) continue;
      if (seen.has(query)) continue;

      seen.add(query);
      entries.push(this.makeEntry('events', row.id, query, 'unknown', 'agent_events'));
    }

    if (entries.length === 0) {
      this.logger.warn(
        'fromAgentEvents: no entries with payload_json.query found in ' +
          'CHAT_SESSION/AGENT_BRAIN events — skipping agent_events source',
      );
    }

    return entries;
  }

  // ── Source: reverse-Q from document_chunks ────────────────────────────────

  /**
   * Sample chunks stratified by (doc_type x sector), generate a reverse
   * question per chunk via LLM, and return candidate entries.
   *
   * Hard cap at 30 entries regardless of the limit argument.
   *
   * Fill-from-others: each stratum is over-fetched (quota * 2) so that when
   * a stratum yields fewer rows than its quota, the surplus rows already
   * fetched from other strata can cover the deficit via a round-robin pass.
   *
   * When dryRun=true the LLM is never called; each chunk produces a
   * deterministic placeholder question classified as "unknown".
   */
  async fromChunkReverse(
    limit: number,
    options: FromChunkReverseOptions = {},
  ): Promise<GoldenCandidateEntry[]> {
    const { dryRun = false } = options;
    const effectiveLimit = Math.min(limit, 30);

    // Fetch strata: distinct (doc_type, sector) combinations
    const strataRows = await this.db.execute<{
      doc_type: string | null;
      sector: string | null;
      cnt: string;
    }>(sql`
      SELECT
        metadata->>'doc_type' AS doc_type,
        metadata->>'sector'   AS sector,
        COUNT(*)::text         AS cnt
      FROM document_chunks
      GROUP BY metadata->>'doc_type', metadata->>'sector'
      ORDER BY COUNT(*) DESC
    `);

    if (strataRows.length === 0) {
      this.logger.warn('fromChunkReverse: no document_chunks found, skipping reverse-Q source');
      return [];
    }

    const strataCount = strataRows.length;
    // ceil so the first-pass quota is generous enough to reach effectiveLimit
    const quota = Math.ceil(effectiveLimit / strataCount);

    // Phase 1: fetch quota*2 rows per stratum, take min(rows, quota) first.
    // Keep the overshoot rows as a "reserve" for the fill-up pass.
    const firstPassChunks: Array<{ id: string; content: string }> = [];
    const reservePerStratum: Array<Array<{ id: string; content: string }>> = [];

    for (let i = 0; i < strataRows.length; i++) {
      const stratum = strataRows[i]!;

      const conditions: ReturnType<typeof sql>[] = [];

      if (stratum.doc_type !== null) {
        conditions.push(sql`metadata->>'doc_type' = ${stratum.doc_type}`);
      } else {
        conditions.push(sql`metadata->>'doc_type' IS NULL`);
      }

      if (stratum.sector !== null) {
        conditions.push(sql`metadata->>'sector' = ${stratum.sector}`);
      } else {
        conditions.push(sql`metadata->>'sector' IS NULL`);
      }

      const whereClause = sql.join(conditions, sql` AND `);

      const sampled = await this.db.execute<{ id: string; content: string }>(sql`
        SELECT id, content
        FROM document_chunks
        WHERE ${whereClause}
        ORDER BY RANDOM()
        LIMIT ${quota * 2}
      `);

      const firstPassTake = sampled.slice(0, quota);
      const reserve = sampled.slice(quota);

      firstPassChunks.push(...firstPassTake);
      reservePerStratum.push(reserve);
    }

    // Phase 2: if first pass is short of effectiveLimit, consume reserve rows
    // round-robin across strata until we reach effectiveLimit or exhaust all.
    const allChunks = [...firstPassChunks];
    if (allChunks.length < effectiveLimit) {
      let anyRemaining = true;
      let strataIdx = 0;
      while (allChunks.length < effectiveLimit && anyRemaining) {
        anyRemaining = false;
        for (let round = 0; round < strataCount && allChunks.length < effectiveLimit; round++) {
          const idx = (strataIdx + round) % strataCount;
          const reserve = reservePerStratum[idx]!;
          if (reserve.length > 0) {
            allChunks.push(reserve.shift()!);
            anyRemaining = true;
          }
        }
        strataIdx = (strataIdx + strataCount) % strataCount;
        // If no reserve produced anything this iteration, stop
        if (!anyRemaining) break;
      }
    }

    const entries: GoldenCandidateEntry[] = [];

    for (const chunk of allChunks) {
      if (dryRun) {
        entries.push(
          this.makeEntry(
            'chunk',
            chunk.id,
            '[dry-run] What does this passage describe?',
            'unknown',
            'reverse_from_chunk',
            chunk.id,
          ),
        );
        continue;
      }

      const result = await this.generateReverseQ(chunk.id, chunk.content);
      if (result === null) continue;

      entries.push(
        this.makeEntry(
          'chunk',
          chunk.id,
          result.question,
          result.queryClass,
          'reverse_from_chunk',
          chunk.id,
        ),
      );
    }

    return entries;
  }

  // ── Composition ───────────────────────────────────────────────────────────

  /**
   * Build the full candidate list from all three sources and optionally write
   * it to disk.  When dryRun=true, returns the list without writing.
   *
   * Rejects outputPath equal to "golden.json" (paranoia guard).
   */
  async buildDraft(args: BuildDraftArgs): Promise<GoldenCandidateEntry[]> {
    const {
      limitChat = 30,
      limitEvents = 20,
      limitReverse = 25,
      outputPath,
      dryRun = false,
    } = args;

    if (basename(outputPath) === 'golden.json') {
      throw new Error(
        `Refusing to write to golden.json — outputPath must be a draft file, not the canonical golden set.`,
      );
    }

    const [chatEntries, eventEntries, chunkEntries] = await Promise.all([
      this.fromChatMessages(limitChat),
      this.fromAgentEvents(limitEvents),
      this.fromChunkReverse(limitReverse, { dryRun }),
    ]);

    const all = [...chatEntries, ...eventEntries, ...chunkEntries];

    this.logger.log(
      `buildDraft: ${chatEntries.length} from chat_messages, ` +
        `${eventEntries.length} from agent_events, ` +
        `${chunkEntries.length} from reverse_from_chunk — total ${all.length}`,
    );

    if (dryRun) {
      return all;
    }

    await this.writeDraft(outputPath, all);
    return all;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async generateReverseQ(
    chunkId: string,
    content: string,
  ): Promise<{ question: string; queryClass: QueryClass } | null> {
    const systemPrompt =
      'You are a financial QA dataset builder. Given a document passage, ' +
      'output exactly two lines:\n' +
      'LINE 1: ONE concise user question (12-18 words) that this passage would answer.\n' +
      'LINE 2: The question class. Must be exactly one of: ' +
      'factoid, relational, summary, numeric, navigational\n' +
      'Output nothing else.';

    try {
      const raw = await this.llm.generate(systemPrompt, content.substring(0, 800));
      const lines = raw
        .trim()
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);

      const question = lines[0] ?? '';
      const rawClass = (lines[1] ?? '').toLowerCase().trim() as QueryClass;

      if (!question || question.length < 5) {
        this.logger.warn(`generateReverseQ: empty question for chunk ${chunkId}, skipping`);
        return null;
      }

      const queryClass: QueryClass = CANONICAL_CLASSES.has(rawClass) ? rawClass : 'unknown';

      return { question, queryClass };
    } catch (err) {
      this.logger.warn(`generateReverseQ: LLM failure for chunk ${chunkId}: ${err}`);
      return null;
    }
  }

  private makeEntry(
    sourcePrefix: 'chat' | 'events' | 'chunk',
    sourceRowId: string,
    query: string,
    queryClass: QueryClass,
    source: GoldenCandidateEntry['source_provenance']['source'],
    sourceChunkId?: string,
  ): GoldenCandidateEntry {
    const shortId = randomBytes(4).toString('hex');
    const provenance: GoldenCandidateEntry['source_provenance'] = {
      source,
      source_row_id: sourceRowId,
    };
    if (sourceChunkId !== undefined) {
      provenance.source_chunk_id = sourceChunkId;
    }

    return {
      id: `draft-${sourcePrefix}-${shortId}`,
      query,
      query_class: queryClass,
      expected_chunk_ids: [],
      acceptable_chunk_ids: [],
      expected_source_docs: [],
      expected_answer: '',
      expected_entities: [],
      difficulty: 'unknown',
      tags: [],
      notes: '',
      source_provenance: provenance,
    };
  }

  private async writeDraft(outputPath: string, entries: GoldenCandidateEntry[]): Promise<void> {
    const absPath = resolve(outputPath);

    const fileExists = await access(absPath)
      .then(() => true)
      .catch(() => false);

    if (fileExists) {
      const ts = Date.now();
      const prevPath = absPath.replace(/\.json$/, `.prev-${ts}.json`);
      await rename(absPath, prevPath);
      this.logger.log(`Moved existing draft to ${prevPath}`);
    }

    const payload = JSON.stringify(entries, null, 2);
    await writeFile(absPath, payload, 'utf8');
    this.logger.log(`Wrote ${entries.length} candidates to ${absPath}`);
  }
}
