import { z } from 'zod';

// --- AgentScheduleRequest ---
export const agentScheduleRequestSchema = z.object({
  name: z.string().min(1),
  cronExpression: z.string().min(1),
  taskType: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});
export type AgentScheduleRequest = z.infer<typeof agentScheduleRequestSchema>;

// --- AgentScheduleResponse ---
export const agentScheduleResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  cronExpression: z.string(),
  taskType: z.string(),
  payload: z.record(z.string(), z.unknown()),
  enabled: z.boolean(),
  lastRunAt: z.string().datetime().nullable(),
  nextRunAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AgentScheduleResponse = z.infer<typeof agentScheduleResponseSchema>;

// --- HeartbeatConfigRequest ---
export const heartbeatConfigRequestSchema = z.object({
  enabled: z.boolean().optional(),
  intervalSeconds: z.number().int().min(60).max(3600).optional(),
  drawdownAlertPct: z
    .string()
    .refine(
      (v) => {
        const n = parseFloat(v);
        return !isNaN(n) && n >= 0.1 && n <= 95.0;
      },
      { message: 'drawdownAlertPct must be between 0.10 and 95.00' },
    )
    .optional(),
});
export type HeartbeatConfigRequest = z.infer<typeof heartbeatConfigRequestSchema>;

// --- HeartbeatConfigResponse ---
export const heartbeatConfigResponseSchema = z.object({
  enabled: z.boolean(),
  intervalSeconds: z.number().int(),
  drawdownAlertPct: z.string(),
  lastBeatAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
});
export type HeartbeatConfigResponse = z.infer<typeof heartbeatConfigResponseSchema>;
