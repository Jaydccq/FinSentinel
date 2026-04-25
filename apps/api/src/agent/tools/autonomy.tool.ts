import { defineZodTool as tool } from '@finsentinel/ai-runtime';
import { z } from 'zod';
import { ScheduleService } from '../../autonomy/schedule.service';
import { HeartbeatService } from '../../autonomy/heartbeat.service';

/**
 * Autonomy management tools — cron tasks and heartbeat configuration.
 *
 * userId is injected via closure (factory param), NOT as a tool parameter.
 *
 * Autonomy-management tool surface exposed to the agent.
 */
export function createAutonomyTools(
  scheduleService: ScheduleService,
  heartbeatService: HeartbeatService,
  userId: string,
) {
  return {
    createCronTask: tool({
      description:
        'Create an autonomous cron task the AI can run on schedule. ' +
        'Task types: PORTFOLIO_REVIEW, MARKET_PULSE, BRAIN_REVIEW, HEARTBEAT_WAKEUP. ' +
        "Use cron format like '0 */2 * * * *' for every 2 hours.",
      inputSchema: z.object({
        name: z.string().describe('Human-readable schedule name'),
        cronExpression: z
          .string()
          .describe("Cron expression with seconds, e.g. '0 0 9 * * MON-FRI'"),
        taskType: z
          .enum(['PORTFOLIO_REVIEW', 'MARKET_PULSE', 'BRAIN_REVIEW', 'HEARTBEAT_WAKEUP'])
          .describe('Task type: PORTFOLIO_REVIEW, MARKET_PULSE, BRAIN_REVIEW, HEARTBEAT_WAKEUP'),
        payloadJson: z
          .string()
          .optional()
          .describe('Optional JSON payload. Example: {"tickers":["AAPL","MSFT"]}'),
      }),
      execute: async ({ name, cronExpression, taskType, payloadJson }) => {
        try {
          return await scheduleService.createCronTask(
            userId,
            name,
            cronExpression,
            taskType,
            payloadJson,
          );
        } catch (e) {
          return `Error creating cron task: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    listCronTasks: tool({
      description: 'List all autonomous cron tasks for the current user.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          return await scheduleService.listCronTasks(userId);
        } catch (e) {
          return `Error listing cron tasks: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    pauseCronTask: tool({
      description: 'Pause an autonomous cron task by ID.',
      inputSchema: z.object({
        scheduleId: z.string().describe('Schedule UUID'),
      }),
      execute: async ({ scheduleId }) => {
        try {
          return await scheduleService.pauseCronTask(userId, scheduleId);
        } catch (e) {
          return `Error pausing cron task: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    resumeCronTask: tool({
      description: 'Resume an autonomous cron task by ID.',
      inputSchema: z.object({
        scheduleId: z.string().describe('Schedule UUID'),
      }),
      execute: async ({ scheduleId }) => {
        try {
          return await scheduleService.resumeCronTask(userId, scheduleId);
        } catch (e) {
          return `Error resuming cron task: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    deleteCronTask: tool({
      description: 'Delete an autonomous cron task by ID.',
      inputSchema: z.object({
        scheduleId: z.string().describe('Schedule UUID'),
      }),
      execute: async ({ scheduleId }) => {
        try {
          return await scheduleService.deleteCronTask(userId, scheduleId);
        } catch (e) {
          return `Error deleting cron task: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    configureHeartbeat: tool({
      description:
        'Configure autonomous heartbeat wake-up behavior. ' +
        'Heartbeat checks wallet health periodically and emits alert events on drawdown breaches.',
      inputSchema: z.object({
        enabled: z.boolean().describe('Enable heartbeat loop'),
        intervalSeconds: z.number().int().describe('Heartbeat interval in seconds, e.g. 600'),
        drawdownAlertPct: z.number().describe('Drawdown alert threshold percent, e.g. 10.0'),
      }),
      execute: async ({ enabled, intervalSeconds, drawdownAlertPct }) => {
        try {
          return await heartbeatService.configureHeartbeat(
            userId,
            enabled,
            intervalSeconds,
            drawdownAlertPct,
          );
        } catch (e) {
          return `Error configuring heartbeat: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    getHeartbeatConfig: tool({
      description: 'Show current heartbeat configuration and last wake-up timestamp.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          return await heartbeatService.getHeartbeatConfig(userId);
        } catch (e) {
          return `Error reading heartbeat config: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),
  };
}
