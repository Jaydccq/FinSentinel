import { Injectable, Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  agentEvents,
  eq,
  and,
  gt,
  desc,
  asc,
} from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';
import { sql } from 'drizzle-orm';
import type {
  AgentEventAggregateType,
  AgentEventType,
} from '@finsentinel/shared';

/**
 * Append-only event log with idempotency keys, sequence numbers, and typed events.
 *
 * Core invariant: events are NEVER updated or deleted.
 * The `seqNo` column is GENERATED ALWAYS AS IDENTITY by PostgreSQL.
 */
@Injectable()
export class AgentEventService {
  constructor(
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
  ) {}

  /**
   * Append a new event to the log.
   *
   * If an `idempotencyKey` is provided and already exists for this user,
   * the existing event is returned without creating a duplicate.
   */
  async append(
    userId: string,
    aggregateType: AgentEventAggregateType,
    aggregateId: string | null,
    eventType: AgentEventType,
    payload: Record<string, unknown> | null,
    idempotencyKey: string | null,
  ) {
    // Idempotency check
    if (idempotencyKey != null && idempotencyKey.trim() !== '') {
      const [existing] = await this.db
        .select()
        .from(agentEvents)
        .where(
          and(
            eq(agentEvents.userId, userId),
            eq(agentEvents.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);

      if (existing) {
        return existing;
      }
    }

    // Insert new event.
    // Supply id + createdAt explicitly. Drizzle+postgres.js (0.44.7 / 3.4.8)
    // scrambles bind parameters when INSERT mixes `default` keywords with `$N`
    // placeholders for non-generated columns — setting them here avoids that
    // codegen path. seq_no stays `default` because it's GENERATED ALWAYS AS
    // IDENTITY and cannot be set from client code.
    const [created] = await this.db
      .insert(agentEvents)
      .values({
        id: randomUUID(),
        userId,
        aggregateType,
        aggregateId: aggregateId ?? undefined,
        eventType,
        payloadJson: payload ?? {},
        idempotencyKey: idempotencyKey ?? undefined,
        createdAt: new Date(),
      })
      .returning();

    return created;
  }

  /**
   * Get the most recent events for a user, ordered by seqNo descending.
   * Limit is clamped to [1, 500], defaulting to 50.
   */
  async getRecent(userId: string, limit: number | null) {
    const safeLimit = Math.min(Math.max(limit ?? 50, 1), 500);

    return this.db
      .select()
      .from(agentEvents)
      .where(eq(agentEvents.userId, userId))
      .orderBy(desc(agentEvents.seqNo))
      .limit(safeLimit);
  }

  /**
   * List all events for a specific aggregate instance, ordered by seqNo ascending.
   */
  async listByAggregate(
    userId: string,
    aggregateType: AgentEventAggregateType,
    aggregateId: string,
  ) {
    return this.db
      .select()
      .from(agentEvents)
      .where(
        and(
          eq(agentEvents.userId, userId),
          eq(agentEvents.aggregateType, aggregateType),
          eq(agentEvents.aggregateId, aggregateId),
        ),
      )
      .orderBy(asc(agentEvents.seqNo));
  }

  /**
   * Replay events after a given sequence number, ordered ascending.
   * Used for event sourcing replay from a known checkpoint.
   */
  async replayAfter(userId: string, afterSeqNo: number) {
    return this.db
      .select()
      .from(agentEvents)
      .where(
        and(
          eq(agentEvents.userId, userId),
          gt(agentEvents.seqNo, afterSeqNo),
        ),
      )
      .orderBy(asc(agentEvents.seqNo));
  }

  /**
   * Count total events for a user.
   */
  async countByUser(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(agentEvents)
      .where(eq(agentEvents.userId, userId));

    return row?.count ?? 0;
  }
}
