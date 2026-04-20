import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ragConfig } from '../rag.config';

describe('ragConfig.rollout', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...origEnv };
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('defaults: mode=off, shadowSampleRate=1.0, shadowTimeoutMs=2000, shadowConcurrency=4, shadowMaxQueueDepth=200, anonMultiplier=0.5', () => {
    delete process.env['RAG_ROLLOUT_MODE'];
    delete process.env['RAG_SHADOW_SAMPLE_RATE'];
    delete process.env['RAG_SHADOW_TIMEOUT_MS'];
    delete process.env['RAG_SHADOW_CONCURRENCY'];
    delete process.env['RAG_SHADOW_MAX_QUEUE_DEPTH'];
    delete process.env['RAG_ROLLOUT_ANON_PERCENT_MULTIPLIER'];
    const cfg = ragConfig();
    expect(cfg.rollout.mode).toBe('off');
    expect(cfg.rollout.shadowSampleRate).toBe(1.0);
    expect(cfg.rollout.shadowTimeoutMs).toBe(2000);
    expect(cfg.rollout.shadowConcurrency).toBe(4);
    expect(cfg.rollout.shadowMaxQueueDepth).toBe(200);
    expect(cfg.rollout.anonMultiplier).toBe(0.5);
  });

  it('5-class canary default (exact_lookup=100, others=10) — no colloquial', () => {
    delete process.env['RAG_ROLLOUT_CANARY_PERCENT_BY_CLASS'];
    const cfg = ragConfig();
    expect(cfg.rollout.canaryPercentByClass).toEqual({
      exact_lookup: 100,
      factoid: 10,
      relational: 10,
      analytical: 10,
      multi_part: 10,
    });
    expect(cfg.rollout.canaryPercentByClass).not.toHaveProperty('colloquial');
  });

  it('accepts RAG_ROLLOUT_MODE=shadow', () => {
    process.env['RAG_ROLLOUT_MODE'] = 'shadow';
    expect(ragConfig().rollout.mode).toBe('shadow');
  });

  it('throws on invalid RAG_ROLLOUT_MODE', () => {
    process.env['RAG_ROLLOUT_MODE'] = 'gradual';
    expect(() => ragConfig()).toThrow(/RAG_ROLLOUT_MODE must be one of/);
  });

  it('parses RAG_ROLLOUT_CANARY_PERCENT_BY_CLASS as JSON', () => {
    process.env['RAG_ROLLOUT_CANARY_PERCENT_BY_CLASS'] = '{"factoid":25,"analytical":50}';
    const cfg = ragConfig();
    expect(cfg.rollout.canaryPercentByClass).toEqual({ factoid: 25, analytical: 50 });
  });

  it('throws on invalid RAG_ROLLOUT_CANARY_PERCENT_BY_CLASS JSON', () => {
    process.env['RAG_ROLLOUT_CANARY_PERCENT_BY_CLASS'] = 'not-json';
    expect(() => ragConfig()).toThrow(/RAG_ROLLOUT_CANARY_PERCENT_BY_CLASS must be valid JSON/);
  });

  it('throws on out-of-range value in RAG_ROLLOUT_CANARY_PERCENT_BY_CLASS', () => {
    process.env['RAG_ROLLOUT_CANARY_PERCENT_BY_CLASS'] = '{"factoid":150}';
    expect(() => ragConfig()).toThrow(/must be 0\.\.100/);
  });
});
