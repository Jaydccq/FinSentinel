import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ragConfig } from '../rag.config';

describe('ragConfig.metadataPrefilter', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...origEnv };
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('defaults: mode=soft, hardMinConfidence=0.85, llmFallbackEnabled=false', () => {
    delete process.env['RAG_METADATA_PREFILTER_MODE'];
    delete process.env['RAG_METADATA_HARD_FILTER_MIN_CONFIDENCE'];
    delete process.env['RAG_METADATA_LLM_FALLBACK_ENABLED'];
    const cfg = ragConfig();
    expect(cfg.metadataPrefilter.mode).toBe('soft');
    expect(cfg.metadataPrefilter.hardMinConfidence).toBe(0.85);
    expect(cfg.metadataPrefilter.llmFallbackEnabled).toBe(false);
  });

  it('respects RAG_METADATA_PREFILTER_MODE=hard', () => {
    process.env['RAG_METADATA_PREFILTER_MODE'] = 'hard';
    expect(ragConfig().metadataPrefilter.mode).toBe('hard');
  });

  it('parses RAG_METADATA_MIN_CANDIDATES_BY_CLASS as JSON', () => {
    process.env['RAG_METADATA_MIN_CANDIDATES_BY_CLASS'] = '{"exact_lookup":10,"factoid":20}';
    const cfg = ragConfig();
    expect(cfg.metadataPrefilter.minCandidatesByClass).toEqual({ exact_lookup: 10, factoid: 20 });
  });

  it('throws on malformed RAG_METADATA_MIN_CANDIDATES_BY_CLASS JSON', () => {
    process.env['RAG_METADATA_MIN_CANDIDATES_BY_CLASS'] = 'not-json';
    expect(() => ragConfig()).toThrow(/RAG_METADATA_MIN_CANDIDATES_BY_CLASS/);
  });

  it('throws on non-integer value', () => {
    process.env['RAG_METADATA_MIN_CANDIDATES_BY_CLASS'] = '{"exact_lookup":"five"}';
    expect(() => ragConfig()).toThrow(/non-integer/);
  });

  it('5-class default when RAG_METADATA_MIN_CANDIDATES_BY_CLASS is unset', () => {
    delete process.env['RAG_METADATA_MIN_CANDIDATES_BY_CLASS'];
    const cfg = ragConfig();
    expect(cfg.metadataPrefilter.minCandidatesByClass).toEqual({
      exact_lookup: 5,
      factoid: 15,
      relational: 20,
      analytical: 30,
      multi_part: 30,
    });
  });
});
