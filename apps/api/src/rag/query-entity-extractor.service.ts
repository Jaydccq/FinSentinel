// apps/api/src/rag/query-entity-extractor.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { isKnownTicker } from './ticker-whitelist';

/**
 * Module-private duck type the service expects callers to match.
 * Deliberately omits AbortSignal — on timeout the service orphans the
 * in-flight promise and swallows its eventual settlement. The R4.4
 * OpenRouter adapter MUST NOT rely on downstream cancellation through
 * this interface; if cancellation becomes important, widen the interface
 * there and thread AbortSignal through.
 */
interface LlmClientLike {
  complete(prompt: string): Promise<string>;
}

const LlmResponseSchema = z.object({
  tickers: z.array(z.object({ value: z.string(), confidence: z.number().min(0).max(1) })),
  issuerNames: z.array(z.object({ value: z.string(), confidence: z.number().min(0).max(1) })),
  sectors: z.array(z.object({ value: z.string(), confidence: z.number().min(0).max(1) })),
  regions: z.array(z.object({ value: z.string(), confidence: z.number().min(0).max(1) })),
  docType: z.object({ value: z.string(), confidence: z.number().min(0).max(1) }).nullable(),
  timeRange: z.object({
    after: z.string().nullable().optional(),
    before: z.string().nullable().optional(),
    confidence: z.number().min(0).max(1),
  }).nullable(),
});

export interface EntityHit<T> { value: T; confidence: number; }

export interface ExtractedEntities {
  tickers: EntityHit<string>[];
  issuerNames: EntityHit<string>[];
  // '10-K' | '10-Q' | '8-K' are regex-reachable; 'news' | 'research' | 'filing' | 'other'
  // are reserved for the R4.1c LLM path.
  docType?: EntityHit<'10-K' | '10-Q' | '8-K' | 'news' | 'research' | 'filing' | 'other'>;
  timeRange?: { after?: Date; before?: Date; confidence: number };
  sectors: EntityHit<string>[];
  regions: EntityHit<string>[];
  fallbackFlag?: 'llm_empty' | 'llm_error' | 'llm_timeout' | 'llm_circuit_open' | 'llm_disabled';
}

export interface QueryEntityExtractorConfig {
  llmFallbackEnabled: boolean;
  llmClient: unknown | null; // typed fully in R4.1c
  hardMinConfidence: number; // consumed by metadata-pre-filter, unused here
  timeoutMs: number;
  concurrency: number;
}

const TOKEN_RE = /\b[A-Z]{2,5}\b/g;
const FY_RE = /\bFY(\d{4})\b/i;
const Q_RE = /\bQ([1-4])\s*20(\d{2})\b/i;
const YEAR_RE = /\b(20\d{2})\b/;
const DOC_TYPE_RE = /\b(10-K|10-Q|8-K|annual report|quarterly report)\b/i;

const CIRCUIT_OPEN_DURATION_MS = 30_000;
const CIRCUIT_FAILURE_THRESHOLD = 3;

@Injectable()
export class QueryEntityExtractorService {
  private readonly logger = new Logger(QueryEntityExtractorService.name);

  // Circuit-breaker state (per-instance, not shared across requests)
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  // Concurrency tracking
  private inflightCount = 0;

  constructor(private readonly config: QueryEntityExtractorConfig) {}

  async extract(query: string): Promise<ExtractedEntities> {
    const regexHits = this.regexPass(query);
    // If ANY structured signal came out of regex, skip the LLM fallback. issuerNames
    // is included today for R4.1c forward-compat — the regex path does not populate
    // it, but when the LLM path lands, this predicate should cover that field too.
    const hasAnyHit =
      regexHits.tickers.length > 0 ||
      regexHits.issuerNames.length > 0 ||
      regexHits.docType !== undefined ||
      regexHits.timeRange !== undefined;

    // Regex produced something — return it without LLM fallback.
    if (hasAnyHit) return regexHits;

    // Regex was empty AND LLM fallback is off — emit a structured flag
    // so callers can tell apart "regex empty, LLM disabled" vs "regex empty, LLM errored".
    if (!this.config.llmFallbackEnabled) {
      return { ...regexHits, fallbackFlag: 'llm_disabled' };
    }

    // Circuit breaker — open if within cooldown window.
    if (Date.now() < this.circuitOpenUntil) {
      return { ...regexHits, fallbackFlag: 'llm_circuit_open' };
    }

    // Concurrency cap — treat saturation the same as circuit open for observers.
    if (this.inflightCount >= this.config.concurrency) {
      return { ...regexHits, fallbackFlag: 'llm_circuit_open' };
    }

    return this.runLlmFallback(query, regexHits);
  }

  private async runLlmFallback(
    query: string,
    regexHits: ExtractedEntities,
  ): Promise<ExtractedEntities> {
    const client = this.config.llmClient as LlmClientLike | null;
    if (!client) {
      return { ...regexHits, fallbackFlag: 'llm_disabled' };
    }

    this.inflightCount++;
    let timerId: ReturnType<typeof setTimeout> | undefined;
    try {
      const prompt = this.buildPrompt(query);

      // Race the LLM call against the timeout.
      const timer = new Promise<never>((_, reject) => {
        timerId = setTimeout(() => reject(new Error('__llm_timeout__')), this.config.timeoutMs);
      });
      const raw = await Promise.race([client.complete(prompt), timer]);
      clearTimeout(timerId);

      // Parse and validate the response.
      let parsed: z.infer<typeof LlmResponseSchema>;
      try {
        parsed = LlmResponseSchema.parse(JSON.parse(raw));
      } catch {
        // Invalid / unexpected shape → treat as empty.
        this.logger.warn('LLM response failed zod parse; returning llm_empty');
        // Parse failures (zod reject, malformed JSON) intentionally do NOT increment
        // consecutiveFailures. Rationale: a persistent schema mismatch from the upstream
        // model is a prompt/model issue, not a connectivity failure — the circuit breaker
        // is not the right tool for it. The master flag (llmFallbackEnabled) is the
        // operator escape hatch. Track llm_empty rate separately via observability if
        // this becomes a cost concern.
        return { ...regexHits, fallbackFlag: 'llm_empty' };
      }

      // Successful parse — reset the circuit and merge results.
      // Merge rules: regex tickers / docType / timeRange are authoritative;
      // LLM fills issuerNames / sectors / regions.
      this.consecutiveFailures = 0;
      return {
        tickers: regexHits.tickers,
        issuerNames: parsed.issuerNames,
        sectors: parsed.sectors,
        regions: parsed.regions,
        ...(regexHits.docType ? { docType: regexHits.docType } : {}),
        ...(regexHits.timeRange ? { timeRange: regexHits.timeRange } : {}),
      };
    } catch (err: unknown) {
      clearTimeout(timerId);
      const isTimeout =
        err instanceof Error && err.message === '__llm_timeout__';

      this.consecutiveFailures++;
      if (this.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
        this.circuitOpenUntil = Date.now() + CIRCUIT_OPEN_DURATION_MS;
        this.logger.warn(
          `LLM circuit breaker opened after ${this.consecutiveFailures} consecutive failures`,
        );
        // Reset the counter when the circuit opens so that after the cooldown,
        // recovery requires CIRCUIT_FAILURE_THRESHOLD new consecutive failures —
        // not a single probe failure. This matches the standard half-open pattern.
        this.consecutiveFailures = 0;
      }

      const flag = isTimeout ? 'llm_timeout' : 'llm_error';
      return { ...regexHits, fallbackFlag: flag };
    } finally {
      this.inflightCount--;
    }
  }

  private buildPrompt(query: string): string {
    return (
      'Extract financial entities from the following query. ' +
      'Return a JSON object with keys: tickers, issuerNames, sectors, regions, docType, timeRange. ' +
      'Each array item has { value: string, confidence: number (0-1) }. ' +
      'docType and timeRange may be null.\n\n' +
      `Query: ${query}`
    );
  }

  private regexPass(query: string): ExtractedEntities {
    // Tickers — whitelist lookup against the R3 curated list.
    const tickers: EntityHit<string>[] = [];
    const seen = new Set<string>();
    for (const token of query.match(TOKEN_RE) ?? []) {
      if (isKnownTicker(token) && !seen.has(token)) {
        tickers.push({ value: token, confidence: 0.95 });
        seen.add(token);
      }
    }

    // DocType — five input patterns ("10-K", "10-Q", "8-K", "annual report",
    // "quarterly report") normalised down to three canonical output values.
    let docType: ExtractedEntities['docType'];
    const dt = query.match(DOC_TYPE_RE);
    if (dt?.[1]) {
      const raw = dt[1].toLowerCase();
      const normalised: '10-K' | '10-Q' | '8-K' =
        raw.startsWith('annual') ? '10-K'
        : raw.startsWith('quarterly') ? '10-Q'
        : (dt[1].toUpperCase() as '10-K' | '10-Q' | '8-K');
      docType = { value: normalised, confidence: 0.9 };
    }

    // TimeRange — FY > Q+year > bare year. First match wins.
    let timeRange: ExtractedEntities['timeRange'];
    const fy = query.match(FY_RE);
    const qy = query.match(Q_RE);
    const yr = query.match(YEAR_RE);
    if (fy?.[1]) {
      const y = Number(fy[1]);
      timeRange = {
        after: new Date(Date.UTC(y, 0, 1)),
        before: new Date(Date.UTC(y, 11, 31)),
        confidence: 0.95,
      };
    } else if (qy?.[1] && qy[2]) {
      const q = Number(qy[1]);
      const y = 2000 + Number(qy[2]);
      timeRange = {
        after: new Date(Date.UTC(y, (q - 1) * 3, 1)),
        before: new Date(Date.UTC(y, q * 3, 0)),
        confidence: 0.9,
      };
    } else if (yr?.[1]) {
      const y = Number(yr[1]);
      timeRange = {
        after: new Date(Date.UTC(y, 0, 1)),
        before: new Date(Date.UTC(y, 11, 31)),
        confidence: 0.85,
      };
    }

    return {
      tickers,
      issuerNames: [],
      sectors: [],
      regions: [],
      ...(docType ? { docType } : {}),
      ...(timeRange ? { timeRange } : {}),
    };
  }
}
