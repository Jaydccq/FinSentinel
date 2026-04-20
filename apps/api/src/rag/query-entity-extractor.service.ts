// apps/api/src/rag/query-entity-extractor.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { isKnownTicker } from './ticker-whitelist';

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

@Injectable()
export class QueryEntityExtractorService {
  private readonly logger = new Logger(QueryEntityExtractorService.name);

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

    // LLM fallback branch is wired in R4.1c. For now, behave as if disabled.
    return { ...regexHits, fallbackFlag: 'llm_disabled' };
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
