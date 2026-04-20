import { sql } from '@finsentinel/db';
import type { SQL } from 'drizzle-orm';
import type { RepresentationType } from '@finsentinel/db';

/**
 * Field-weighted tsvector builder for the four representation types.
 *
 * Output uses to_tsvector('simple', ...) + setweight to stay consistent with
 * SparseSearchService which queries via websearch_to_tsquery('simple', ...).
 * A stemmer-config mismatch (e.g. writing with 'english' here) would silently
 * reduce recall, so all sites use 'simple'.
 *
 * All user-provided strings flow through Drizzle's `sql``` parameter binding —
 * never string-interpolated or passed to `sql.raw()` — to avoid SQL injection
 * via quotes/backslashes/`$$` in chunk text.
 *
 * Field weighting per type:
 *   contextual_text : A = title + section_path, B = contextual prose, C = chunk tail
 *   sample_question : A = sample questions (joined), B = chunk content snippet
 *   summary         : A = summary, C = title
 *   keyword_entity  : A = entities/keywords blob, C = title (for short-text grounding)
 *
 * `keyword_entity` today stores a comma-separated blob in `content` (entities,
 * tickers, keywords are not separated upstream by the LLM schema in
 * chunk-representation.service.ts). We weight the whole blob at A.
 */

export interface TsvectorInputs {
  /** Chunk meta_title — used across all types as A- or C-weight grounding. */
  title: string | null;
  /** Chunk section path (e.g. "Results > Revenue") — A-weight for contextual_text. */
  sectionPath: string | null;
  /** Parent chunk content (for C-weight tail on contextual / B-weight snippet on sample_question). */
  chunkContent: string | null;
  /** The representation row's own content payload (e.g. contextual paragraph, summary, keywords). */
  representationContent: string;
}

/** Max characters of the parent chunk to include in the tsvector tail slot. */
const CHUNK_TAIL_MAX_CHARS = 500;
/** Max characters of the parent chunk to include in the sample-question B slot. */
const SAMPLE_QUESTION_SNIPPET_MAX_CHARS = 200;

/**
 * Returns a parameterised Drizzle SQL fragment suitable for the
 * `search_vector` column of `document_chunk_representations`. The caller must
 * pass the representation type + parent-chunk/title context.
 */
export function buildRepresentationTsvector(
  type: RepresentationType,
  inputs: TsvectorInputs,
): SQL<unknown> {
  const title = inputs.title ?? '';
  const sectionPath = inputs.sectionPath ?? '';
  const chunkContent = inputs.chunkContent ?? '';
  const repContent = inputs.representationContent;

  switch (type) {
    case 'contextual_text': {
      // A = title + section_path (canonical grounding)
      // B = contextual prose (the LLM-generated context paragraph)
      // C = short chunk tail (helps when the contextual prose omits a keyword)
      const chunkTail = chunkContent.slice(0, CHUNK_TAIL_MAX_CHARS);
      return sql`setweight(to_tsvector('simple', coalesce(${title}, '')), 'A') ||
                 setweight(to_tsvector('simple', coalesce(${sectionPath}, '')), 'A') ||
                 setweight(to_tsvector('simple', coalesce(${repContent}, '')), 'B') ||
                 setweight(to_tsvector('simple', coalesce(${chunkTail}, '')), 'C')`;
    }
    case 'sample_question': {
      // A = sample questions joined (these are the highest-signal lexical probe)
      // B = chunk content snippet (so a query matching the answer text also matches)
      const snippet = chunkContent.slice(0, SAMPLE_QUESTION_SNIPPET_MAX_CHARS);
      return sql`setweight(to_tsvector('simple', coalesce(${repContent}, '')), 'A') ||
                 setweight(to_tsvector('simple', coalesce(${snippet}, '')), 'B')`;
    }
    case 'summary': {
      // A = summary sentence
      // C = title (low-weight grounding so short summaries still match title-heavy queries)
      return sql`setweight(to_tsvector('simple', coalesce(${repContent}, '')), 'A') ||
                 setweight(to_tsvector('simple', coalesce(${title}, '')), 'C')`;
    }
    case 'keyword_entity': {
      // A = keywords/entities blob — today the service stores a comma-separated
      //     string in content; once upstream splits entities/tickers/keywords
      //     into distinct fields we can split this across A/B/C.
      // C = title (grounding for short keyword-only rows)
      return sql`setweight(to_tsvector('simple', coalesce(${repContent}, '')), 'A') ||
                 setweight(to_tsvector('simple', coalesce(${title}, '')), 'C')`;
    }
    default: {
      // Exhaustiveness: if a new representation type is added, TS will flag it.
      const _exhaustive: never = type;
      throw new Error(`unhandled representation type: ${String(_exhaustive)}`);
    }
  }
}
