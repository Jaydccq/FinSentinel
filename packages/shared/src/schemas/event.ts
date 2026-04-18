import { z } from 'zod';

export { runtimeTimelineEventSchema } from './context-journal';

// --- AgentEventResponse ---
export const agentEventResponseSchema = z.object({
  id: z.string().uuid(),
  seqNo: z.number().int().nullable(),
  userId: z.string().uuid(),
  aggregateType: z.string(),
  aggregateId: z.string().uuid(),
  eventType: z.string(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});
export type AgentEventResponse = z.infer<typeof agentEventResponseSchema>;
