import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineZodTool, toAgentTools } from './tools';

describe('defineZodTool', () => {
  it('keeps the legacy inputSchema while exposing Pi parameters', async () => {
    const tool = defineZodTool({
      description: 'Echo a value',
      inputSchema: z.object({ value: z.string() }),
      execute: async ({ value }) => `echo:${value}`,
    });

    expect(tool.description).toBe('Echo a value');
    expect(tool.inputSchema.parse({ value: 'x' })).toEqual({ value: 'x' });
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: {
        value: {
          type: 'string',
        },
      },
      required: ['value'],
    });
    expect(await tool.execute({ value: 'x' })).toBe('echo:x');
  });
});

describe('toAgentTools', () => {
  it('converts a tool set into pi-agent-core tools keyed by record name', async () => {
    const tools = toAgentTools({
      echo: defineZodTool({
        description: 'Echo a value',
        inputSchema: z.object({ value: z.string() }),
        execute: async ({ value }) => `echo:${value}`,
      }),
    });

    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe('echo');
    expect(tools[0]!.label).toBe('echo');

    const result = await tools[0]!.execute(
      'call-1',
      { value: 'ok' },
      new AbortController().signal,
      () => {},
    );
    expect(result.content).toEqual([{ type: 'text', text: 'echo:ok' }]);
  });

  it('throws when schema validation fails so the agent records a tool error', async () => {
    const [tool] = toAgentTools({
      echo: defineZodTool({
        description: 'Echo a value',
        inputSchema: z.object({ value: z.string() }),
        execute: async ({ value }) => `echo:${value}`,
      }),
    });

    await expect(
      tool!.execute('call-1', { value: 123 }, new AbortController().signal, () => {}),
    ).rejects.toThrow(/value/);
  });
});
