import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoleExecutorService } from '../teams/role-executor.service';
import { ROLE_TOOL_SCOPE } from '../contracts/role-tool-scope';

vi.mock('@finsentinel/ai-runtime', () => ({
  createOpenAICompatibleModel: vi.fn(() => 'mock-model'),
  generateAgentText: vi
    .fn()
    .mockResolvedValue(
      '{"summary":"s","thesis":"t","risks":[],"openQuestions":[],"citations":[],"confidence":0.7}',
    ),
}));

describe('RoleExecutorService.run', () => {
  let mockStream: ReturnType<typeof vi.fn>;
  let toolRegistry: { buildTools: ReturnType<typeof vi.fn> };
  let svc: RoleExecutorService;

  beforeEach(() => {
    mockStream = vi.fn().mockResolvedValue({
      text: `\`\`\`json\n{"summary":"s","thesis":"t","risks":[],"openQuestions":[],"citations":[],"confidence":0.7}\n\`\`\``,
    });
    toolRegistry = {
      buildTools: vi.fn().mockReturnValue({
        evaluateStrategyTemplate: {},
        getStockQuote: {},
        stageOrder: {},
      }),
    };
    svc = new RoleExecutorService(toolRegistry as never, { generate: mockStream } as never);
  });

  it('filters tools to the role allow-list before calling the LLM', async () => {
    await svc.run({
      roleKey: 'MARKET_ANALYST',
      systemPrompt: 'sys',
      userInput: { prompt: 'x', contextText: 'ctx', priorStageOutputs: {} },
    });
    const invoked = mockStream.mock.calls[0]?.[0]?.tools;
    expect(invoked).toBeDefined();
    expect(Object.keys(invoked)).toContain('getStockQuote');
    expect(Object.keys(invoked)).toContain('evaluateStrategyTemplate');
    expect(Object.keys(invoked)).not.toContain('stageOrder');
    expect(ROLE_TOOL_SCOPE.MARKET_ANALYST.includes('stageOrder' as never)).toBe(false);
  });

  it('parses the JSON block into structured output + retains raw markdown', async () => {
    const out = await svc.run({
      roleKey: 'MARKET_ANALYST',
      systemPrompt: 'sys',
      userInput: { prompt: 'x', contextText: '', priorStageOutputs: {} },
    });
    expect(out.structured).toMatchObject({ summary: 's', thesis: 't', confidence: 0.7 });
    expect(out.rawMarkdown).toContain('```json');
  });

  it('throws if the LLM response contains no parseable JSON block', async () => {
    mockStream.mockResolvedValue({ text: 'no json here' });
    await expect(
      svc.run({
        roleKey: 'MARKET_ANALYST',
        systemPrompt: 'sys',
        userInput: { prompt: 'x', contextText: '', priorStageOutputs: {} },
      }),
    ).rejects.toThrow(/no JSON/i);
  });

  it('returns durationMs and toolCallCount on the role output', async () => {
    const out = await svc.run({
      roleKey: 'THESIS_LEAD',
      systemPrompt: 'lead',
      userInput: { prompt: 'go', contextText: '', priorStageOutputs: {} },
    });
    expect(out.durationMs).toBeGreaterThanOrEqual(0);
    expect(out.toolCallCount).toBeGreaterThanOrEqual(0);
  });

  it('accepts optional runtimeConfig without error', async () => {
    const out = await svc.run({
      roleKey: 'MARKET_ANALYST',
      systemPrompt: 'sys',
      userInput: { prompt: 'x', contextText: '', priorStageOutputs: {} },
      runtimeConfig: { researchDepth: 'DEEP' },
    });
    expect(out.roleKey).toBe('MARKET_ANALYST');
  });
});
