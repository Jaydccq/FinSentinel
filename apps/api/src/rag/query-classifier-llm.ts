import { Injectable, Inject, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { createOpenAICompatibleModel, generateAgentText } from '@finsentinel/ai-runtime';
import { aiConfig } from '../config/ai.config';
import type { QueryClass } from './query-classifier-rules';

/**
 * System prompt used by the LLM classifier. The class definitions mirror the
 * rule classifier so we can measure whether the LLM helps OR hurts on the
 * same vocabulary; vocabulary expansion (numeric / summary etc.) is a
 * separate planner-policy decision (see the phase-1 plan).
 */
export const QUERY_CLASSIFIER_SYSTEM_PROMPT = `Classify each financial-research query into exactly one of:
- exact_lookup: literal section / ticker+time / quoted phrase / numeric id (ISIN, CUSIP, EPS, P/E)
- factoid: short factual question with a single answer
- relational: about relationships between companies / entities (competitors, suppliers, partners, board members, CEO of)
- analytical: requires analysis, compare, explain, summarize, impact, risk, driver, outlook
- multi_part: contains multiple distinct sub-questions joined with "and" / "?"
- colloquial: chitchat / non-research (hi, thanks, bye, ok, etc.)

Respond with ONLY a single-line JSON object: {"class":"<class>","confidence":<0..1>,"reasoning":"<one short sentence>"}`;

/**
 * Few-shot exemplars. One per class for unambiguous anchoring.
 *
 * NOTE: real users submit queries that don't look like the exemplars; the
 * shadow eval surfaces if the LLM over-fits to these shapes. Keep this list
 * short and unambiguous — do not turn it into a rule encyclopaedia.
 */
export const QUERY_CLASSIFIER_FEW_SHOT: ReadonlyArray<{ q: string; class: QueryClass }> = [
  { q: 'AAPL Q4 2025 EPS', class: 'exact_lookup' },
  { q: 'What is the current Apple revenue?', class: 'factoid' },
  { q: 'who are competitors of Tesla?', class: 'relational' },
  { q: 'compare Apple and Microsoft margin trends', class: 'analytical' },
  { q: 'What is Tesla revenue and what is the operating margin?', class: 'multi_part' },
  { q: 'hi can you help me out?', class: 'colloquial' },
];

export interface LlmClassification {
  class: QueryClass;
  confidence: number;
  reasoning?: string;
  /** Set to true when the LLM response could not be parsed and we fell back. */
  parseFallback?: boolean;
}

const VALID_CLASSES: ReadonlyArray<QueryClass> = [
  'exact_lookup',
  'factoid',
  'relational',
  'analytical',
  'multi_part',
  'colloquial',
];

/**
 * Build the few-shot prompt block that gets prefixed to the user query.
 * The runtime client (`generateAgentText`) takes a single `prompt` string
 * plus a `systemPrompt`, so we encode the few-shot exemplars inline rather
 * than as a multi-message history. This is functionally equivalent for the
 * classifier (deterministic temperature-0 single-turn).
 */
export function buildClassifierPrompt(query: string): string {
  const examples = QUERY_CLASSIFIER_FEW_SHOT.map(
    (s) =>
      `Query: ${s.q}\nResponse: ${JSON.stringify({
        class: s.class,
        confidence: 1,
        reasoning: 'few-shot exemplar',
      })}`,
  ).join('\n\n');

  return `${examples}\n\nQuery: ${query}\nResponse:`;
}

/**
 * LLM-based query classifier — phase-1 SHADOW only. Not yet wired into the
 * runtime planner default routing.
 *
 * Reuses the OpenRouter chat path via `@finsentinel/ai-runtime`'s
 * `generateAgentText`, mirroring `QueryRewriteService` exactly so we don't
 * fork a new HTTP client.
 */
@Injectable()
export class LlmQueryClassifierService {
  private readonly logger = new Logger(LlmQueryClassifierService.name);
  private readonly model;

  constructor(@Inject(aiConfig.KEY) private readonly aiCfg: ConfigType<typeof aiConfig>) {
    this.model = createOpenAICompatibleModel({
      provider: this.aiCfg.provider ?? 'openrouter',
      modelId: this.aiCfg.model,
      baseUrl: this.aiCfg.baseUrl ?? this.aiCfg.openrouterBaseUrl,
    });
  }

  async classify(query: string): Promise<LlmClassification> {
    if (!query || !query.trim()) {
      return { class: 'factoid', confidence: 0, reasoning: 'empty_query', parseFallback: true };
    }

    try {
      const raw = await generateAgentText({
        model: this.model,
        apiKey: this.aiCfg.apiKey ?? this.aiCfg.openrouterApiKey,
        systemPrompt: QUERY_CLASSIFIER_SYSTEM_PROMPT,
        prompt: buildClassifierPrompt(query),
        tools: {},
      });
      return parseLlmResponse(raw, query);
    } catch (err) {
      this.logger.warn(`LLM classifier failed, falling back to factoid: ${err}`);
      return {
        class: 'factoid',
        confidence: 0,
        reasoning: `llm_error:${(err as Error)?.message ?? 'unknown'}`,
        parseFallback: true,
      };
    }
  }
}

/**
 * Parse the LLM response. The model may wrap JSON in code fences or include
 * trailing whitespace; we extract the first `{...}` block we find.
 */
export function parseLlmResponse(raw: string, query: string): LlmClassification {
  if (!raw) {
    return {
      class: 'factoid',
      confidence: 0,
      reasoning: `parse_failed:empty for "${query.slice(0, 80)}"`,
      parseFallback: true,
    };
  }

  const match = raw.match(/\{[\s\S]*?\}/);
  if (!match) {
    return {
      class: 'factoid',
      confidence: 0,
      reasoning: `parse_failed:no_json for "${query.slice(0, 80)}"`,
      parseFallback: true,
    };
  }

  try {
    const obj = JSON.parse(match[0]) as {
      class?: unknown;
      confidence?: unknown;
      reasoning?: unknown;
    };
    const cls = typeof obj.class === 'string' ? obj.class : '';
    if (!VALID_CLASSES.includes(cls as QueryClass)) {
      return {
        class: 'factoid',
        confidence: 0,
        reasoning: `parse_failed:bad_class:${cls} for "${query.slice(0, 80)}"`,
        parseFallback: true,
      };
    }
    const confidence = Number(obj.confidence ?? 0.5);
    const reasoning = typeof obj.reasoning === 'string' ? obj.reasoning : undefined;
    return {
      class: cls as QueryClass,
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5,
      reasoning,
    };
  } catch (err) {
    return {
      class: 'factoid',
      confidence: 0,
      reasoning: `parse_failed:${(err as Error)?.message ?? 'unknown'} for "${query.slice(0, 80)}"`,
      parseFallback: true,
    };
  }
}
