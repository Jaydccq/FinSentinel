import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReportService } from './report.service';
import { ReportController } from './report.controller';

/**
 * Report module — Phase 12B.
 *
 * Provides:
 * - ReportService — creates, retrieves, and exports risk reports
 * - ReportController — GET /reports/:id/pdf for PDF download
 *
 * Reports are stored in the `riskReports` table and tied to
 * portfolios. The service verifies portfolio ownership for all
 * operations.
 */
@Module({
  imports: [AuthModule],
  controllers: [ReportController],
  providers: [ReportService],
  exports: [ReportService],
})
export class ReportModule {}
