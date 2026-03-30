import { Injectable, Inject } from '@nestjs/common';
import { agentHeartbeatConfigs, eq } from '@finsentinel/db';

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Inject('DRIZZLE_DB') private readonly db: any,
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

    return created;
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

    return updated;
  }
}
