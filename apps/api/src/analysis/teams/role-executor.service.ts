import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import {
  stageStructuredOutputSchema,
  type StageStructuredOutput,
} from '@finsentinel/shared';
import { aiConfig } from '../../config/ai.config';
import { ToolRegistry } from '../../agent/tool-registry';
import { ROLE_TOOL_SCOPE } from '../contracts/role-tool-scope';
import type {
  RoleDefinition,
  RoleInput,
  RoleKey,
  RoleOutput,
} from '../contracts/role-contract';

export interface LlmRunner {
  generate(args: {
    model: unknown;
    system: string;
    prompt: string;
    tools: Record<string, unknown>;
  }): Promise<{ text: string }>;
}

export const ROLE_EXECUTOR_LLM_TOKEN = 'ROLE_EXECUTOR_LLM';

@Injectable()
export class RoleExecutorService {
  private readonly logger = new Logger(RoleExecutorService.name);
  private readonly model: unknown;

  constructor(
    private readonly toolRegistry: ToolRegistry,
    @Optional() @Inject(ROLE_EXECUTOR_LLM_TOKEN)
    private readonly llm?: LlmRunner,
    @Optional() @Inject(aiConfig.KEY)
    aiCfg?: ConfigType<typeof aiConfig>,
  ) {
    if (aiCfg) {
      const openrouter = createOpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: aiCfg.openrouterApiKey,
      });
      this.model = openrouter(aiCfg.model);
    } else {
      this.model = undefined;
    }
  }

  async run(args: {
    roleKey: RoleKey;
    systemPrompt: string;
    userInput: RoleInput;
  }): Promise<RoleOutput> {
    const scope = ROLE_TOOL_SCOPE[args.roleKey];
    const fullTools = this.getAllTools();
    const scopedTools: Record<string, unknown> = {};
    for (const name of scope) {
      if (fullTools[name]) scopedTools[name] = fullTools[name];
    }

    const userPrompt = this.buildUserPrompt(args.userInput);
    const llm = this.llm ?? this.defaultLlm();
    const { text } = await llm.generate({
      model: this.model,
      system: args.systemPrompt,
      prompt: userPrompt,
      tools: scopedTools,
    });

    const structured = this.parseStructured(text);
    return { roleKey: args.roleKey, structured, rawMarkdown: text };
  }

  private getAllTools(): Record<string, unknown> {
    const registry = this.toolRegistry as unknown as Record<string, unknown>;
    // Try known method names in priority order.
    // buildTools is the full-set method; buildStockAnalysisTools is the lightweight subset.
    // Test fakes may use buildToolSet — check it first so tests work against hand-rolled fakes.
    for (const m of [
      'buildToolSet',
      'buildTools',
      'buildStockAnalysisTools',
      'buildAll',
      'getAll',
      'getTools',
    ]) {
      const fn = registry[m];
      if (typeof fn === 'function') {
        try {
          const result = (fn as () => unknown).call(this.toolRegistry);
          if (result && typeof result === 'object') {
            return result as Record<string, unknown>;
          }
        } catch {
          // ignore and try next
        }
      }
    }
    this.logger.warn('ToolRegistry: no known tool-builder method found; returning empty tool set');
    return {};
  }

  private buildUserPrompt(input: RoleInput): string {
    const lines = [`Task: ${input.prompt}`, '', '## Shared context', input.contextText];
    const prior = Object.entries(input.priorStageOutputs);
    if (prior.length > 0) {
      lines.push('', '## Prior stage outputs (JSON)');
      for (const [stage, out] of prior) {
        lines.push(`### ${stage}`);
        lines.push('```json');
        lines.push(JSON.stringify(out, null, 2));
        lines.push('```');
      }
    }
    if (input.extra) {
      lines.push(
        '',
        '## Additional inputs (JSON)',
        '```json',
        JSON.stringify(input.extra),
        '```',
      );
    }
    return lines.join('\n');
  }

  private parseStructured(text: string): StageStructuredOutput {
    const match = text.match(/```json\s*([\s\S]+?)\s*```/);
    if (!match?.[1]) throw new Error('Role output contains no JSON block');
    const obj = JSON.parse(match[1]) as unknown;
    return stageStructuredOutputSchema.parse(obj);
  }

  private defaultLlm(): LlmRunner {
    return {
      generate: async (args) =>
        generateText({
          model: args.model as never,
          system: args.system,
          prompt: args.prompt,
          tools: args.tools as never,
        }),
    };
  }
}

export function roleDefinition(
  roleKey: RoleKey,
  systemPrompt: string,
): RoleDefinition {
  return { roleKey, systemPrompt, allowedToolNames: ROLE_TOOL_SCOPE[roleKey] };
}
