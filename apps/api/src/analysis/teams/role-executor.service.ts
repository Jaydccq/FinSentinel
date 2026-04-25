import { Injectable, Inject, Optional } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { createOpenAICompatibleModel, generateAgentText } from '@finsentinel/ai-runtime';
import type { FinToolSet } from '@finsentinel/ai-runtime';
import {
  stageStructuredOutputSchema,
  type ResearchDepth,
  type StageStructuredOutput,
} from '@finsentinel/shared';
import { aiConfig } from '../../config/ai.config';
import { ToolRegistry } from '../../agent/tool-registry';
import { ROLE_TOOL_SCOPE } from '../contracts/role-tool-scope';
import type { RoleDefinition, RoleInput, RoleKey, RoleOutput } from '../contracts/role-contract';

export function extractStructuredJson(text: string): unknown {
  const fencedJson = /```json\s*([\s\S]+?)\s*```/i.exec(text);
  if (fencedJson?.[1]) {
    try {
      return JSON.parse(fencedJson[1]);
    } catch {
      // fall through
    }
  }

  const fenceAnyRe = /```(?!json\b)([\w]*)\s*([\s\S]+?)\s*```/gi;
  let fenceAnyMatch: RegExpExecArray | null;
  while ((fenceAnyMatch = fenceAnyRe.exec(text)) !== null) {
    const body = fenceAnyMatch[2];
    if (body) {
      try {
        return JSON.parse(body);
      } catch {
        // try next fence
      }
    }
  }

  let searchStart = 0;
  while (true) {
    const openIdx = text.indexOf('{', searchStart);
    if (openIdx < 0) break;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = openIdx; i < text.length; i++) {
      const ch = text[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\' && inString) {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(openIdx, i + 1);
          try {
            return JSON.parse(candidate);
          } catch {
            // candidate was balanced but invalid JSON; try next '{'
          }
          break;
        }
      }
    }
    // advance past this '{' whether balanced-but-invalid or unbalanced
    searchStart = openIdx + 1;
  }

  const snippet = text.slice(0, 200).replace(/\s+/g, ' ');
  throw new Error(`Role output contains no JSON object. Raw (first 200 chars): ${snippet}`);
}

export interface LlmRunner {
  generate(args: {
    model: unknown;
    system: string;
    prompt: string;
    tools: FinToolSet;
    roleKey?: RoleKey;
  }): Promise<{ text: string }>;
}

export const ROLE_EXECUTOR_LLM_TOKEN = 'ROLE_EXECUTOR_LLM';

@Injectable()
export class RoleExecutorService {
  private readonly model: unknown;
  private readonly apiKey?: string;

  constructor(
    private readonly toolRegistry: ToolRegistry,
    @Optional()
    @Inject(ROLE_EXECUTOR_LLM_TOKEN)
    private readonly llm?: LlmRunner,
    @Optional()
    @Inject(aiConfig.KEY)
    aiCfg?: ConfigType<typeof aiConfig>,
  ) {
    if (aiCfg) {
      this.model = createOpenAICompatibleModel({
        provider: aiCfg.provider ?? 'openrouter',
        modelId: aiCfg.model,
        baseUrl: aiCfg.baseUrl ?? aiCfg.openrouterBaseUrl,
      });
      this.apiKey = aiCfg.apiKey ?? aiCfg.openrouterApiKey;
    } else {
      this.model = undefined;
      this.apiKey = undefined;
    }
  }

  async run(args: {
    roleKey: RoleKey;
    systemPrompt: string;
    userInput: RoleInput;
    runtimeConfig?: { researchDepth: ResearchDepth };
    userId?: string;
  }): Promise<RoleOutput> {
    const startedAt = Date.now();
    // runtimeConfig is threaded through the signature for downstream use
    // (e.g. future prompt/tool shaping by researchDepth). It is intentionally
    // unused in this task — see plan doc Task 1.4.
    void args.runtimeConfig;

    const scope = ROLE_TOOL_SCOPE[args.roleKey];
    const fullTools = this.getAllTools(args.userId);
    const scopedTools: FinToolSet = {};
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
      roleKey: args.roleKey,
    });

    const structured = this.parseStructured(text);
    // NOTE: scope-size proxy (not per-call invocation count) — see RoleOutput.toolCallCount JSDoc.
    return {
      roleKey: args.roleKey,
      structured,
      rawMarkdown: text,
      durationMs: Date.now() - startedAt,
      toolCallCount: Object.keys(scopedTools).length,
    };
  }

  private getAllTools(userId?: string): FinToolSet {
    const registry = this.toolRegistry as unknown as {
      buildTools(userId?: string): FinToolSet;
    };
    if (typeof registry.buildTools !== 'function') return {};
    return registry.buildTools(userId) ?? {};
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
      lines.push('', '## Additional inputs (JSON)', '```json', JSON.stringify(input.extra), '```');
    }
    return lines.join('\n');
  }

  private parseStructured(text: string): StageStructuredOutput {
    const obj = extractStructuredJson(text);
    return stageStructuredOutputSchema.parse(obj);
  }

  private defaultLlm(): LlmRunner {
    return {
      generate: async (args) => ({
        text: await generateAgentText({
          model: args.model as never,
          apiKey: this.apiKey,
          systemPrompt: args.system,
          prompt: args.prompt,
          tools: args.tools,
          maxTurns: 10,
        }),
      }),
    };
  }
}

export function roleDefinition(roleKey: RoleKey, systemPrompt: string): RoleDefinition {
  return { roleKey, systemPrompt, allowedToolNames: ROLE_TOOL_SCOPE[roleKey] };
}
