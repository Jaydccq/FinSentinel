import { fauxAssistantMessage, fauxText, fauxToolCall, registerFauxProvider } from '@mariozechner/pi-ai';
import { Agent } from '@mariozechner/pi-agent-core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineZodTool } from './tools';
import { collectAsyncText, generateAgentText, streamAgentTextFromMessages } from './text-runtime';

describe('collectAsyncText', () => {
  it('collects async text chunks', async () => {
    async function* chunks(): AsyncIterable<string> {
      yield 'hello';
      yield ' ';
      yield 'world';
    }

    await expect(collectAsyncText(chunks())).resolves.toEqual(['hello', ' ', 'world']);
  });
});

describe('generateAgentText', () => {
  it('returns text from a single prompt', async () => {
    const provider = registerFauxProvider({
      models: [{ id: 'test-model' }],
    });

    try {
      provider.setResponses([fauxAssistantMessage([fauxText('hello world')])]);

      const text = await generateAgentText({
        model: provider.getModel(),
        systemPrompt: 'You are concise.',
        tools: {},
        prompt: 'Say hello',
      });

      expect(text).toBe('hello world');
      expect(provider.state.callCount).toBe(1);
    } finally {
      provider.unregister();
    }
  });

  it('executes a tool call and continues to final text', async () => {
    const provider = registerFauxProvider({
      models: [{ id: 'test-model' }],
    });

    const tools = {
      echo: defineZodTool({
        description: 'Echo a value',
        inputSchema: z.object({ value: z.string() }),
        execute: async ({ value }) => `echo:${value}`,
      }),
    };

    try {
      provider.setResponses([
        fauxAssistantMessage([fauxToolCall('echo', { value: 'AAPL' })], { stopReason: 'toolUse' }),
        fauxAssistantMessage([fauxText('tool said AAPL')]),
      ]);

      const text = await generateAgentText({
        model: provider.getModel(),
        systemPrompt: 'You are concise.',
        tools,
        prompt: 'Use the tool and answer.',
      });

      expect(text).toBe('tool said AAPL');
      expect(provider.state.callCount).toBe(2);
    } finally {
      provider.unregister();
    }
  });

  it('fails when the max turn guard is exceeded', async () => {
    const provider = registerFauxProvider({
      models: [{ id: 'test-model' }],
    });

    const tools = {
      echo: defineZodTool({
        description: 'Echo a value',
        inputSchema: z.object({ value: z.string() }),
        execute: async ({ value }) => `echo:${value}`,
      }),
    };

    try {
      provider.setResponses([
        fauxAssistantMessage([fauxToolCall('echo', { value: 'AAPL' })], { stopReason: 'toolUse' }),
        fauxAssistantMessage([fauxText('tool said AAPL')]),
      ]);

      await expect(
        generateAgentText({
          model: provider.getModel(),
          systemPrompt: 'You are concise.',
          tools,
          maxTurns: 1,
          prompt: 'Use the tool and answer.',
        }),
      ).rejects.toThrow(/max turns/i);
      expect(provider.state.callCount).toBe(2);
    } finally {
      provider.unregister();
    }
  });

  it('throws when the provider returns an error assistant message', async () => {
    const provider = registerFauxProvider({
      models: [{ id: 'test-model' }],
    });

    try {
      provider.setResponses([
        fauxAssistantMessage('', {
          stopReason: 'error',
          errorMessage: 'provider failed',
        }),
      ]);

      await expect(
        generateAgentText({
          model: provider.getModel(),
          systemPrompt: 'You are concise.',
          tools: {},
          prompt: 'Say hello',
        }),
      ).rejects.toThrow('provider failed');
    } finally {
      provider.unregister();
    }
  });
});

describe('streamAgentTextFromMessages', () => {
  it('streams text from existing user messages and makes one provider call', async () => {
    const provider = registerFauxProvider({
      models: [{ id: 'test-model' }],
    });

    try {
      provider.setResponses([fauxAssistantMessage([fauxText('streamed')])]);

      const stream = streamAgentTextFromMessages({
        model: provider.getModel(),
        systemPrompt: 'You are concise.',
        tools: {},
        messages: [
          { role: 'user', content: 'Earlier user note' },
          { role: 'assistant', content: 'Earlier assistant note' },
          { role: 'user', content: 'Say hello again' },
        ],
      });

      await expect(collectAsyncText(stream)).resolves.toEqual(['streamed']);
      expect(provider.state.callCount).toBe(1);
    } finally {
      provider.unregister();
    }
  });

  it('returns no chunks when history ends with an assistant message', async () => {
    const provider = registerFauxProvider({
      models: [{ id: 'test-model' }],
    });

    try {
      provider.setResponses([fauxAssistantMessage([fauxText('should not be used')])]);

      const stream = streamAgentTextFromMessages({
        model: provider.getModel(),
        systemPrompt: 'You are concise.',
        tools: {},
        messages: [
          { role: 'user', content: 'Earlier user note' },
          { role: 'assistant', content: 'Earlier assistant note' },
        ],
      });

      await expect(collectAsyncText(stream)).resolves.toEqual([]);
      expect(provider.state.callCount).toBe(0);
    } finally {
      provider.unregister();
    }
  });

  it('aborts the agent when the stream is closed early', async () => {
    const provider = registerFauxProvider({
      models: [{ id: 'test-model' }],
      tokensPerSecond: 1,
      tokenSize: { min: 1, max: 1 },
    });

    const abortSpy = vi.spyOn(Agent.prototype, 'abort');

    const tools = {
      echo: defineZodTool({
        description: 'Echo a value',
        inputSchema: z.object({ value: z.string() }),
        execute: async ({ value }) => `echo:${value}`,
      }),
    };

    try {
      provider.setResponses([
        fauxAssistantMessage([fauxText('partial response before tool call '), fauxToolCall('echo', { value: 'AAPL' })], {
          stopReason: 'toolUse',
        }),
        fauxAssistantMessage([fauxText('final answer')]),
      ]);

      const iterator = streamAgentTextFromMessages({
        model: provider.getModel(),
        systemPrompt: 'You are concise.',
        tools,
        messages: [{ role: 'user', content: 'Use the tool and answer.' }],
      })[Symbol.asyncIterator]();

      const first = await iterator.next();

      expect(first.done).toBe(false);
      expect(first.value).toBeDefined();

      await iterator.return?.();

      expect(abortSpy).toHaveBeenCalledTimes(1);
      expect(provider.state.callCount).toBe(1);
    } finally {
      abortSpy.mockRestore();
      provider.unregister();
    }
  });

  it('throws when the streaming provider terminates with an error', async () => {
    const provider = registerFauxProvider({
      models: [{ id: 'test-model' }],
    });

    try {
      provider.setResponses([
        fauxAssistantMessage('', {
          stopReason: 'error',
          errorMessage: 'stream failed',
        }),
      ]);

      const stream = streamAgentTextFromMessages({
        model: provider.getModel(),
        systemPrompt: 'You are concise.',
        tools: {},
        messages: [{ role: 'user', content: 'Say hello' }],
      });

      await expect(collectAsyncText(stream)).rejects.toThrow('stream failed');
    } finally {
      provider.unregister();
    }
  });
});
