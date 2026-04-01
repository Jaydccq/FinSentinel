import { Module } from '@nestjs/common';
import { ReportService } from './report.service';

/**
 * Report module — Phase 12B.
 *
 * Provides:
 * - ReportService — creates, retrieves, and exports risk reports
 *
 * Reports are stored in the `riskReports` table and tied to
 * portfolios. The service verifies portfolio ownership for all
 * operations.
 */
@Module({
  providers: [ReportService],
  exports: [ReportService],
})
export class ReportModule {}
