import { Agent, type AgentMessage } from '@mariozechner/pi-agent-core';
import type { Model } from '@mariozechner/pi-ai';
import { toAgentTools, type FinToolSet } from './tools';

const ZERO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
} as const;

export interface ChatMessageInput {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentTextOptions {
  model: Model<any>;
  systemPrompt: string;
  tools: FinToolSet;
  maxTurns?: number;
}

export interface GenerateAgentTextOptions extends AgentTextOptions {
  prompt: string;
}

export interface StreamAgentTextOptions extends AgentTextOptions {
  messages: ChatMessageInput[];
}

function createAssistantMessage(content: string, model: Model<any>, timestamp: number): AgentMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: content }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { ...ZERO_USAGE },
    stopReason: 'stop',
    timestamp,
  };
}

function toAgentMessages(messages: ChatMessageInput[], model: Model<any>): AgentMessage[] {
  const baseTimestamp = Date.now();

  return messages.map((message, index) => {
    const timestamp = baseTimestamp + index;

    if (message.role === 'assistant') {
      return createAssistantMessage(message.content, model, timestamp);
    }

    return {
      role: 'user',
      content: message.content,
      timestamp,
    };
  });
}

function createAgent(options: AgentTextOptions, messages?: ChatMessageInput[]): Agent {
  const agent = new Agent({
    initialState: {
      systemPrompt: options.systemPrompt,
      model: options.model,
      thinkingLevel: 'off',
      tools: toAgentTools(options.tools),
      messages: messages ? toAgentMessages(messages, options.model) : [],
    },
    toolExecution: 'parallel',
  });

  return agent;
}

function createTextStream() {
  const chunks: string[] = [];
  let finished = false;
  let waitingResolve: ((result: IteratorResult<string>) => void) | undefined;

  return {
    push(chunk: string) {
      if (finished) {
        return;
      }

      if (waitingResolve) {
        const resolve = waitingResolve;
        waitingResolve = undefined;
        resolve({ value: chunk, done: false });
        return;
      }

      chunks.push(chunk);
    },
    close() {
      if (finished) {
        return;
      }

      finished = true;
      if (waitingResolve) {
        const resolve = waitingResolve;
        waitingResolve = undefined;
        resolve({ value: undefined, done: true });
      }
    },
    async next(): Promise<IteratorResult<string>> {
      if (chunks.length > 0) {
        return { value: chunks.shift() as string, done: false };
      }

      if (finished) {
        return { value: undefined, done: true };
      }

      return await new Promise<IteratorResult<string>>((resolve) => {
        waitingResolve = resolve;
      });
    },
  };
}

function runAgentText(
  agent: Agent,
  run: () => Promise<void>,
  maxTurns: number,
): AsyncIterable<string> {
  const textStream = createTextStream();
  let turnCount = 0;
  let maxTurnsExceeded = false;
  let runnerSettled = false;

  const unsubscribe = agent.subscribe((event) => {
    if (event.type === 'turn_start') {
      turnCount += 1;
      if (turnCount > maxTurns) {
        maxTurnsExceeded = true;
        agent.abort();
        return;
      }
    }

    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      textStream.push(event.assistantMessageEvent.delta);
    }
  });

  const maxTurnsError = new Error(`Agent exceeded max turns (${maxTurns})`);
  const runner = run()
    .catch((error) => {
      if (maxTurnsExceeded) {
        throw maxTurnsError;
      }

      throw error;
    })
    .finally(() => {
      runnerSettled = true;
      textStream.close();
    });

  return {
    async *[Symbol.asyncIterator]() {
      try {
        while (true) {
          const next = await textStream.next();
          if (next.done) {
            break;
          }

          yield next.value;
        }

        await runner;
        if (maxTurnsExceeded) {
          throw maxTurnsError;
        }
      } catch (error) {
        throw error;
      } finally {
        unsubscribe();
        if (!runnerSettled) {
          agent.abort();
        }
        textStream.close();
        await runner.catch(() => undefined);
      }
    },
  };
}

export async function generateAgentText(options: GenerateAgentTextOptions): Promise<string> {
  const stream = await streamAgentTextFromMessages({
    model: options.model,
    systemPrompt: options.systemPrompt,
    tools: options.tools,
    maxTurns: options.maxTurns,
    messages: [{ role: 'user', content: options.prompt }],
  });

  return (await collectAsyncText(stream)).join('');
}

export async function* streamAgentTextFromMessages(
  options: StreamAgentTextOptions,
): AsyncIterable<string> {
  const agent = createAgent(options, options.messages);
  const maxTurns = options.maxTurns ?? 10;
  const lastMessage = options.messages[options.messages.length - 1];

  if (!lastMessage || lastMessage.role !== 'user') {
    return;
  }

  yield* runAgentText(agent, () => agent.continue(), maxTurns);
}

export async function collectAsyncText(stream: AsyncIterable<string>): Promise<string[]> {
  const chunks: string[] = [];

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return chunks;
}
