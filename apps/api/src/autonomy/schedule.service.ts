import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { agentSchedules, eq, and, desc } from '@finsentinel/db';
import { sql } from 'drizzle-orm';

/** Maximum number of schedules per user. */
const MAX_SCHEDULES_PER_USER = 20;

/**
 * Basic cron expression validation.
 * Accepts 5-field (minute hour day month weekday) or 6-field (+ second) cron strings.
 */
function isValidCron(expression: string): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length < 5 || parts.length > 6) return false;

  // Each field must contain only valid cron characters
  const cronFieldPattern = /^[0-9*,\-/LW#?]+$/;
  return parts.every((p) => cronFieldPattern.test(p));
}

/**
 * Schedule service — CRUD for user-defined cron tasks.
 *
 * Each user can have up to MAX_SCHEDULES_PER_USER (20) schedules.
 * Schedules are stored in the agent_schedules table and executed by
 * the runtime scheduler (to be wired in a future phase).
 */
@Injectable()
export class ScheduleService {
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Inject('DRIZZLE_DB') private readonly db: any,
  ) {}

  /** List all schedules for a user, newest first. */
  async listByUser(userId: string) {
    return this.db
      .select()
      .from(agentSchedules)
      .where(eq(agentSchedules.userId, userId))
      .orderBy(desc(agentSchedules.createdAt));
  }

  /** Create a new schedule after validating cron expression and user limits. */
  async create(
    userId: string,
    name: string,
    cronExpression: string,
    taskType: string,
    payload: Record<string, unknown> = {},
    enabled: boolean = true,
  ) {
    // Validate cron expression
    if (!isValidCron(cronExpression)) {
      throw new BadRequestException(
        `Invalid cron expression: "${cronExpression}". ` +
        'Expected 5 or 6 space-separated fields.',
      );
    }

    // Check user limit
    const [countRow] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(agentSchedules)
      .where(eq(agentSchedules.userId, userId));

    const currentCount = Number(countRow?.count ?? 0);
    if (currentCount >= MAX_SCHEDULES_PER_USER) {
      throw new BadRequestException(
        `Maximum of ${MAX_SCHEDULES_PER_USER} schedules per user reached.`,
      );
    }

    const [created] = await this.db
      .insert(agentSchedules)
      .values({
        userId,
        name,
        cronExpression,
        taskType,
        taskPayload: payload,
        enabled,
      })
      .returning();

    return created;
  }

  /** Update an existing schedule. Only the schedule owner can update. */
  async update(
    userId: string,
    scheduleId: string,
    fields: Partial<{
      name: string;
      cronExpression: string;
      taskType: string;
      taskPayload: Record<string, unknown>;
      enabled: boolean;
    }>,
  ) {
    // Verify ownership
    const [existing] = await this.db
      .select()
      .from(agentSchedules)
      .where(
        and(
          eq(agentSchedules.id, scheduleId),
          eq(agentSchedules.userId, userId),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new NotFoundException(`Schedule ${scheduleId} not found.`);
    }

    // Validate cron if provided
    if (fields.cronExpression && !isValidCron(fields.cronExpression)) {
      throw new BadRequestException(
        `Invalid cron expression: "${fields.cronExpression}".`,
      );
    }

    const [updated] = await this.db
      .update(agentSchedules)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(agentSchedules.id, scheduleId))
      .returning();

    return updated;
  }

  /** Pause a schedule (set enabled = false). */
  async pause(userId: string, scheduleId: string) {
    return this.update(userId, scheduleId, { enabled: false });
  }

  /** Resume a schedule (set enabled = true). */
  async resume(userId: string, scheduleId: string) {
    return this.update(userId, scheduleId, { enabled: true });
  }

  /** Delete a schedule. Only the schedule owner can delete. */
  async delete(userId: string, scheduleId: string): Promise<void> {
    // Verify ownership
    const [existing] = await this.db
      .select()
      .from(agentSchedules)
      .where(
        and(
          eq(agentSchedules.id, scheduleId),
          eq(agentSchedules.userId, userId),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new NotFoundException(`Schedule ${scheduleId} not found.`);
    }

    await this.db
      .delete(agentSchedules)
      .where(eq(agentSchedules.id, scheduleId));
  }

  async createCronTask(
    userId: string,
    name: string,
    cronExpression: string,
    taskType: string,
    payloadJson?: string,
  ): Promise<string> {
    const payload = payloadJson
      ? (JSON.parse(payloadJson) as Record<string, unknown>)
      : {};
    const created = await this.create(
      userId,
      name,
      cronExpression,
      taskType,
      payload,
      true,
    );
    return `Created cron task ${created.id} (${created.name}).`;
  }

  async listCronTasks(userId: string): Promise<string> {
    const schedules = await this.listByUser(userId);
    if (schedules.length === 0) {
      return 'No cron tasks configured.';
    }
    return JSON.stringify(schedules, null, 2);
  }

  async pauseCronTask(userId: string, scheduleId: string): Promise<string> {
    await this.pause(userId, scheduleId);
    return `Paused cron task ${scheduleId}.`;
  }

  async resumeCronTask(userId: string, scheduleId: string): Promise<string> {
    await this.resume(userId, scheduleId);
    return `Resumed cron task ${scheduleId}.`;
  }

  async deleteCronTask(userId: string, scheduleId: string): Promise<string> {
    await this.delete(userId, scheduleId);
    return `Deleted cron task ${scheduleId}.`;
  }
}
