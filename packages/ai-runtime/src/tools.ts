import { Type, type TSchema } from '@mariozechner/pi-ai';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { z, type ZodTypeAny } from 'zod';
import zodToJsonSchema from 'zod-to-json-schema';

export interface FinTool<TSchemaDef extends ZodTypeAny = ZodTypeAny> {
  description: string;
  inputSchema: TSchemaDef;
  parameters: TSchema;
  execute: (args: z.infer<TSchemaDef>) => Promise<string> | string;
}

export type FinToolSet = Record<string, FinTool<any>>;

export function defineZodTool<TSchemaDef extends ZodTypeAny>(definition: {
  description: string;
  inputSchema: TSchemaDef;
  execute: (args: z.infer<TSchemaDef>) => Promise<string> | string;
}): FinTool<TSchemaDef> {
  return {
    ...definition,
    parameters: Type.Unsafe(
      zodToJsonSchema(definition.inputSchema, { target: 'jsonSchema7' }) as TSchema,
    ),
  };
}

export function toAgentTools(toolSet: FinToolSet): AgentTool[] {
  return Object.entries(toolSet).map(([name, tool]) => ({
    name,
    label: name,
    description: tool.description,
    parameters: tool.parameters,
    execute: async (_toolCallId, params, _signal, _onUpdate): Promise<AgentToolResult<{}>> => {
      const parsed = tool.inputSchema.parse(params);
      const text = await tool.execute(parsed);

      return {
        content: [{ type: 'text', text }],
        details: {},
      };
    },
  }));
}
