/**
 * golden-candidates.cli.spec.ts
 *
 * Tests for the exported makeGoldenLlmClientFactory function.
 * These exercise the bootstrap-time guard without booting Nest.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

// Mock @finsentinel/ai-runtime so the factory can be imported without
// real credentials and without actually calling the OpenRouter API.
vi.mock('@finsentinel/ai-runtime', () => ({
  createOpenAICompatibleModel: vi.fn(() => ({ _tag: 'mock-model' })),
  DEFAULT_NVIDIA_BASE_URL: 'https://integrate.api.nvidia.com/v1',
  DEFAULT_OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
  DEFAULT_OPENROUTER_TEXT_MODEL: 'google/gemini-3-flash-preview',
  generateAgentText: vi.fn(),
}));

import { makeGoldenLlmClientFactory } from '../golden-candidates.cli';

describe('makeGoldenLlmClientFactory', () => {
  const originalEnv = process.env['OPENROUTER_API_KEY'];
  const originalNvidiaEnv = process.env['NVIDIA_API_KEY'];
  const originalProvider = process.env['AI_PROVIDER'];
  const originalModel = process.env['AI_MODEL'];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['OPENROUTER_API_KEY'];
    } else {
      process.env['OPENROUTER_API_KEY'] = originalEnv;
    }
    if (originalNvidiaEnv === undefined) {
      delete process.env['NVIDIA_API_KEY'];
    } else {
      process.env['NVIDIA_API_KEY'] = originalNvidiaEnv;
    }
    if (originalProvider === undefined) {
      delete process.env['AI_PROVIDER'];
    } else {
      process.env['AI_PROVIDER'] = originalProvider;
    }
    if (originalModel === undefined) {
      delete process.env['AI_MODEL'];
    } else {
      process.env['AI_MODEL'] = originalModel;
    }
  });

  it('returns a stub LlmTextClient when --dry-run is in argv', () => {
    delete process.env['OPENROUTER_API_KEY'];
    const client = makeGoldenLlmClientFactory(['node', 'golden-candidates.cli.js', '--dry-run']);
    expect(client).toBeDefined();
    expect(typeof client.generate).toBe('function');
  });

  it('stub throws a clear error if generate is accidentally called', async () => {
    delete process.env['OPENROUTER_API_KEY'];
    const client = makeGoldenLlmClientFactory(['--dry-run']);
    await expect(client.generate('sys', 'user')).rejects.toThrow(
      'stub called in dry-run — should not happen',
    );
  });

  it('throws a descriptive error when OPENROUTER_API_KEY is absent and --dry-run is not set', () => {
    delete process.env['OPENROUTER_API_KEY'];
    expect(() => makeGoldenLlmClientFactory([])).toThrow(
      'Missing OPENROUTER_API_KEY. Set it or pass --dry-run to exercise without LLM.',
    );
  });

  it('returns a real LlmTextClient when OPENROUTER_API_KEY is present and --dry-run is absent', () => {
    process.env['OPENROUTER_API_KEY'] = 'test-key-abc';
    const client = makeGoldenLlmClientFactory([]);
    expect(client).toBeDefined();
    expect(typeof client.generate).toBe('function');
  });

  it('returns a real LlmTextClient when NVIDIA provider env is present', () => {
    process.env['AI_PROVIDER'] = 'nvidia';
    process.env['NVIDIA_API_KEY'] = 'nvapi-test';
    process.env['AI_MODEL'] = 'nvidia/test-model';
    delete process.env['OPENROUTER_API_KEY'];

    const client = makeGoldenLlmClientFactory([]);

    expect(client).toBeDefined();
    expect(typeof client.generate).toBe('function');
  });

  it('dry-run takes precedence even when OPENROUTER_API_KEY is set', async () => {
    process.env['OPENROUTER_API_KEY'] = 'test-key-abc';
    // Should return stub without throwing, despite key being present
    const client = makeGoldenLlmClientFactory(['--dry-run']);
    expect(client).toBeDefined();
    // Stub should reject if generate is called
    await expect(client.generate('sys', 'user')).rejects.toThrow('stub called in dry-run');
  });
});
