import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { MetricsService } from '../common/services/metrics.service';
import type { DrizzleDB } from '@finsentinel/db';

interface PartitionRow extends Record<string, unknown> {
  table_name: string;
}

interface InheritsRow extends Record<string, unknown> {
  count: string | number;
}

/**
 * Daily cron that maintains the rag_query_logs partition set.
 *
 * Runs at midnight. Two actions:
 * 1. Drops monthly partitions (matching rag_query_logs_YYYY_MM) whose entire
 *    month falls outside the retention window. Confirms partition membership
 *    via pg_inherits before any DROP to avoid accidental DROP on same-prefix
 *    unrelated tables.
 * 2. Creates next month's partition preemptively so steady-state inserts
 *    never land in rag_query_logs_default.
 *
 * Gated by RAG_QUERY_LOG_RETENTION_ENABLED (default false).
 * The default partition is never dropped.
 */
@Injectable()
export class RagTraceRetentionService implements OnModuleInit {
  private readonly logger = new Logger(RagTraceRetentionService.name);
  private readonly retentionDays: number;
  private readonly retentionEnabled: boolean;

  constructor(
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
    configService: ConfigService,
    private readonly metrics: MetricsService,
  ) {
    this.retentionDays = configService.get<number>('rag.queryLog.retentionDays', 30);
    this.retentionEnabled = configService.get<boolean>(
      'rag.queryLog.retentionEnabled',
      false,
    ) as boolean;
  }

  onModuleInit(): void {
    if (!this.retentionEnabled) {
      this.logger.log(
        'RAG query log retention is disabled (RAG_QUERY_LOG_RETENTION_ENABLED not set).',
      );
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async runRetention(): Promise<void> {
    if (!this.retentionEnabled) return;

    try {
      await this.dropOldPartitions();
      await this.ensureNextMonthPartition();
    } catch (err) {
      this.logger.warn(`RagTraceRetentionService.runRetention failed: ${err}`);
    }
  }

  private async dropOldPartitions(): Promise<void> {
    // Find all tables in the public schema whose names match rag_query_logs_YYYY_MM.
    const rows = await this.db.execute<PartitionRow>(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name ~ '^rag_query_logs_[0-9]{4}_[0-9]{2}$'
    `);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.retentionDays);
    // Round cutoff back to start of month so we only drop months fully outside window.
    const cutoffMonthStart = new Date(cutoff.getFullYear(), cutoff.getMonth(), 1);

    for (const row of rows) {
      const name = row.table_name;
      const match = /^rag_query_logs_(\d{4})_(\d{2})$/.exec(name);
      if (!match) continue;

      const year = Number(match[1]);
      const month = Number(match[2]);
      const partitionMonth = new Date(year, month - 1, 1);

      if (partitionMonth >= cutoffMonthStart) continue;

      // Verify this table is actually a partition of rag_query_logs via pg_inherits.
      const inheritsRows = await this.db.execute<InheritsRow>(sql`
        SELECT count(*) AS count
        FROM pg_inherits
        WHERE inhrelid = ${name}::regclass
          AND inhparent = 'rag_query_logs'::regclass
      `);

      const isPartition = Number(inheritsRows[0]?.count ?? 0) > 0;
      if (!isPartition) {
        this.logger.warn(`Skipping ${name}: not a partition of rag_query_logs per pg_inherits`);
        continue;
      }

      this.logger.log(
        `Dropping old partition ${name} (month ${year}-${String(month).padStart(2, '0')} is before retention cutoff)`,
      );
      // Use identifier interpolation — table name is validated by the regex above.
      await this.db.execute(sql`DROP TABLE IF EXISTS ${sql.identifier(name)}`);
      this.metrics.incrementCounter(
        'rag_trace_partitions_dropped_total',
        'Total rag_query_logs partitions dropped by retention job',
        {},
      );
    }
  }

  private async ensureNextMonthPartition(): Promise<void> {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const monthAfter = new Date(now.getFullYear(), now.getMonth() + 2, 1);

    const partitionName =
      'rag_query_logs_' +
      String(nextMonth.getFullYear()) +
      '_' +
      String(nextMonth.getMonth() + 1).padStart(2, '0');

    const startLiteral = nextMonth.toISOString().slice(0, 10);
    const endLiteral = monthAfter.toISOString().slice(0, 10);

    // Check existence first to avoid a DDL round-trip when partition already exists.
    const existsRows = await this.db.execute<{ count: string | number }>(sql`
      SELECT count(*) AS count
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ${partitionName}
    `);

    if (Number(existsRows[0]?.count ?? 0) > 0) return;

    this.logger.log(
      `Creating next-month partition ${partitionName} [${startLiteral}, ${endLiteral})`,
    );
    await this.db.execute(sql`
      CREATE TABLE IF NOT EXISTS ${sql.identifier(partitionName)}
        PARTITION OF rag_query_logs
        FOR VALUES FROM (${startLiteral}::date) TO (${endLiteral}::date)
    `);
    this.metrics.incrementCounter(
      'rag_trace_partitions_created_total',
      'Total rag_query_logs partitions created by retention job',
      {},
    );
  }
}
