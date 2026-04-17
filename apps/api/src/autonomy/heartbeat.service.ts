import { Injectable, Inject } from '@nestjs/common';
import { agentHeartbeatConfigs, eq } from '@finsentinel/db';
import { sql } from 'drizzle-orm';
import type { DrizzleDB } from '@finsentinel/db';

/**
 * Heartbeat service — manages per-user heartbeat configuration.
 *
 * Each user has a single heartbeat config row that controls:
 * - Whether heartbeat monitoring is enabled
 * - The check interval (seconds)
 * - The drawdown alert threshold (percentage)
 */
@Injectable()
export class HeartbeatService {
  constructor(
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
  ) {}

  /**
   * Get or create the heartbeat config for a user.
   * Creates with defaults if none exists: enabled=true, interval=600s, drawdown=10%.
   */
  async getOrCreateConfig(userId: string) {
    const [existing] = await this.db
      .select()
      .from(agentHeartbeatConfigs)
      .where(eq(agentHeartbeatConfigs.userId, userId))
      .limit(1);

    if (existing) {
      return existing;
    }

    // Create default config
    const [created] = await this.db
      .insert(agentHeartbeatConfigs)
      .values({
        userId,
        enabled: true,
        intervalSeconds: 600,
        drawdownAlertPct: '10.00',
      })
      .returning();

    return created!;
  }

  /**
   * Update the heartbeat config for a user.
   * Creates the config first if it doesn't exist.
   */
  async updateConfig(
    userId: string,
    fields: Partial<{
      enabled: boolean;
      intervalSeconds: number;
      drawdownAlertPct: string;
    }>,
  ) {
    // Ensure config exists
    await this.getOrCreateConfig(userId);

    const [updated] = await this.db
      .update(agentHeartbeatConfigs)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(agentHeartbeatConfigs.userId, userId))
      .returning();

    return updated!;
  }

  async configureHeartbeat(
    userId: string,
    enabled: boolean,
    intervalSeconds: number,
    drawdownAlertPct: number,
  ): Promise<string> {
    const updated = await this.updateConfig(userId, {
      enabled,
      intervalSeconds,
      drawdownAlertPct: drawdownAlertPct.toFixed(2),
    });

    return `Heartbeat ${updated.enabled ? 'enabled' : 'disabled'} at ${updated.intervalSeconds}s with ${updated.drawdownAlertPct}% drawdown alert.`;
  }

  async getHeartbeatConfig(userId: string): Promise<string> {
    const config = await this.getOrCreateConfig(userId);
    return JSON.stringify(config, null, 2);
  }

  async listDueHeartbeats(now: Date = new Date()) {
    // postgres.js (3.4.8) rejects Date bind parameters — pass ISO string instead.
    const nowIso = now.toISOString();
    return this.db
      .select()
      .from(agentHeartbeatConfigs)
      .where(
        sql`${agentHeartbeatConfigs.enabled} = true AND (
          ${agentHeartbeatConfigs.lastBeatAt} IS NULL OR
          ${agentHeartbeatConfigs.lastBeatAt} + (${agentHeartbeatConfigs.intervalSeconds} * interval '1 second') <= ${nowIso}::timestamptz
        )`,
      );
  }

  async markBeat(userId: string, beatAt: Date): Promise<void> {
    await this.db
      .update(agentHeartbeatConfigs)
      .set({ lastBeatAt: beatAt, updatedAt: new Date() })
      .where(eq(agentHeartbeatConfigs.userId, userId));
  }
}
