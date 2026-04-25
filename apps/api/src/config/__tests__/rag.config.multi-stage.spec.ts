import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ragConfig } from '../rag.config';

describe('ragConfig.multiStageEnabled (R7.7)', () => {
  const orig = { ...process.env };
  beforeEach(() => {
    process.env = { ...orig };
  });
  afterEach(() => {
    process.env = { ...orig };
  });

  it('defaults to true when unset', () => {
    delete process.env['RAG_MULTI_STAGE_ENABLED'];
    expect(ragConfig().multiStageEnabled).toBe(true);
  });

  it('is true for empty string', () => {
    process.env['RAG_MULTI_STAGE_ENABLED'] = '';
    expect(ragConfig().multiStageEnabled).toBe(true);
  });

  it('is true for literal "true"', () => {
    process.env['RAG_MULTI_STAGE_ENABLED'] = 'true';
    expect(ragConfig().multiStageEnabled).toBe(true);
  });

  it('is false only for literal "false"', () => {
    process.env['RAG_MULTI_STAGE_ENABLED'] = 'false';
    expect(ragConfig().multiStageEnabled).toBe(false);
  });

  it('is true for other truthy-looking strings', () => {
    process.env['RAG_MULTI_STAGE_ENABLED'] = '1';
    expect(ragConfig().multiStageEnabled).toBe(true);
    process.env['RAG_MULTI_STAGE_ENABLED'] = 'yes';
    expect(ragConfig().multiStageEnabled).toBe(true);
  });
});
