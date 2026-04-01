import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { riskReports, portfolios, eq, and } from '@finsentinel/db';

/** Shape of the data needed to create a risk report. */
export interface CreateReportData {
  portfolioId: string;
  riskScore: number;
  riskLevel: string;
  summary?: string;
  factorsJson?: unknown;
  adviceJson?: unknown;
  disclaimer?: string;
  regulatoryFramework?: string;
}

/** Shape of a risk report returned from the DB. */
export interface RiskReport {
  id: string;
  portfolioId: string;
  riskScore: number;
  riskLevel: string;
  summary: string | null;
  factorsJson: unknown;
  adviceJson: unknown;
  disclaimer: string | null;
  regulatoryFramework: string | null;
  createdAt: Date;
}

/**
 * Report service — generates and retrieves risk reports.
 *
 * Reports are stored in the `riskReports` table and tied to a portfolio.
 * The service verifies portfolio ownership before any operation.
 */
@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name);

  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Inject('DRIZZLE_DB') private readonly db: any,
  ) {}

  /**
   * Generate (create) a risk report for a user's portfolio.
   *
   * @param userId - The authenticated user's ID
   * @param data - Report data including portfolioId, riskScore, etc.
   * @returns The created report record
   * @throws NotFoundException if the portfolio doesn't belong to the user
   */
  async generateReport(userId: string, data: CreateReportData): Promise<RiskReport> {
    // Verify portfolio ownership
    await this.verifyPortfolioOwnership(userId, data.portfolioId);

    const [report] = await this.db
      .insert(riskReports)
      .values({
        portfolioId: data.portfolioId,
        riskScore: data.riskScore,
        riskLevel: data.riskLevel,
        summary: data.summary ?? null,
        factorsJson: data.factorsJson ?? null,
        adviceJson: data.adviceJson ?? null,
        disclaimer: data.disclaimer ?? null,
        regulatoryFramework: data.regulatoryFramework ?? null,
      })
      .returning();

    this.logger.log(
      `Created risk report ${report.id} for portfolio ${data.portfolioId} ` +
      `(score=${data.riskScore}, level=${data.riskLevel})`,
    );

    return report;
  }

  /**
   * Get a single report by ID, verifying it belongs to the user.
   *
   * @throws NotFoundException if the report doesn't exist or doesn't belong to the user
   */
  async getReport(userId: string, reportId: string): Promise<RiskReport> {
    const rows = await this.db
      .select()
      .from(riskReports)
      .where(eq(riskReports.id, reportId))
      .limit(1);

    const report = rows[0];
    if (!report) {
      throw new NotFoundException(`Report ${reportId} not found`);
    }

    // Verify the report's portfolio belongs to the user
    await this.verifyPortfolioOwnership(userId, report.portfolioId);

    return report;
  }

  /**
   * Generate a PDF buffer from a report's content.
   *
   * Currently returns the report summary/factors as a markdown Buffer.
   * Full PDF conversion (e.g. via md-to-pdf) can be added later.
   */
  async getReportPdf(userId: string, reportId: string): Promise<Buffer> {
    const report = await this.getReport(userId, reportId);

    const markdown = this.buildMarkdown(report);
    return Buffer.from(markdown, 'utf-8');
  }

  /** Build a markdown representation of a risk report. */
  private buildMarkdown(report: RiskReport): string {
    const lines: string[] = [
      `# Risk Report`,
      '',
      `**Report ID:** ${report.id}`,
      `**Portfolio ID:** ${report.portfolioId}`,
      `**Risk Score:** ${report.riskScore}`,
      `**Risk Level:** ${report.riskLevel}`,
      `**Generated:** ${report.createdAt instanceof Date ? report.createdAt.toISOString() : report.createdAt}`,
      '',
    ];

    if (report.summary) {
      lines.push('## Summary', '', report.summary, '');
    }

    if (report.factorsJson) {
      lines.push('## Risk Factors', '', '```json', JSON.stringify(report.factorsJson, null, 2), '```', '');
    }

    if (report.adviceJson) {
      lines.push('## Actionable Advice', '', '```json', JSON.stringify(report.adviceJson, null, 2), '```', '');
    }

    if (report.disclaimer) {
      lines.push('---', '', `*${report.disclaimer}*`, '');
    }

    if (report.regulatoryFramework) {
      lines.push(`*Regulatory Framework: ${report.regulatoryFramework}*`, '');
    }

    return lines.join('\n');
  }

  /** Verify that a portfolio belongs to the given user. */
  private async verifyPortfolioOwnership(userId: string, portfolioId: string): Promise<void> {
    const rows = await this.db
      .select({ id: portfolios.id })
      .from(portfolios)
      .where(
        and(
          eq(portfolios.id, portfolioId),
          eq(portfolios.userId, userId),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException(`Portfolio ${portfolioId} not found for user`);
    }
  }
}
