import { describe, it, expect, vi } from 'vitest';
import { ContextFabricService } from '../context-fabric.service';
import { sharedContextSchema } from '@finsentinel/shared';

describe('ContextFabricService.assemble', () => {
  it('returns a schema-valid SharedContext with 4 populated layers', async () => {
    const profile = { load: vi.fn().mockResolvedValue('long-term pref text') };
    const strategy = { load: vi.fn().mockResolvedValue('mid-term strat text') };
    const compaction = { load: vi.fn().mockResolvedValue({ summary: 'session sum', count: 3 }) };
    const rag = {
      retrieve: vi.fn().mockResolvedValue([
        { id: 'doc-1', snippet: 'ret 1' },
        { id: 'doc-2', snippet: 'ret 2' },
      ]),
    };

    const svc = new ContextFabricService(
      profile as never,
      strategy as never,
      compaction as never,
      rag as never,
    );

    const ctx = await svc.assemble({
      userId: 'u1',
      sessionId: 's1',
      prompt: 'analyze AAPL',
    });

    const parsed = sharedContextSchema.parse(ctx);
    expect(parsed.longTermPreferenceContext.summary).toBe('long-term pref text');
    expect(parsed.midTermStrategyContext.summary).toBe('mid-term strat text');
    expect(parsed.shortTermSessionContext.summary).toContain('session sum');
    expect(parsed.retrievalContext.sourceIds).toEqual(['doc-1', 'doc-2']);
  });

  it('toPromptReady() produces a deterministic text format with layer headers', async () => {
    const svc = new ContextFabricService(
      { load: vi.fn().mockResolvedValue('A') } as never,
      { load: vi.fn().mockResolvedValue('B') } as never,
      { load: vi.fn().mockResolvedValue({ summary: 'C', count: 0 }) } as never,
      { retrieve: vi.fn().mockResolvedValue([]) } as never,
    );
    const ctx = await svc.assemble({ userId: 'u1', sessionId: 's1', prompt: 'x' });
    const text = svc.toPromptReady(ctx);
    expect(text).toMatch(/## Long-term preference/);
    expect(text).toMatch(/## Mid-term strategy/);
    expect(text).toMatch(/## Short-term session/);
    expect(text).toMatch(/## Retrieved evidence/);
  });
});
