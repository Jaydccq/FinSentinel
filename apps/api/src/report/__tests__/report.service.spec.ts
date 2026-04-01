import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ReportService } from '../report.service';
import type { CreateReportData } from '../report.service';

// ── Constants ──────────────────────────────────────────────────────────────
const USER_ID = '11111111-1111-1111-1111-111111111111';
const PORTFOLIO_ID = '22222222-2222-2222-2222-222222222222';
const REPORT_ID = '33333333-3333-3333-3333-333333333333';

const SAMPLE_REPORT = {
  id: REPORT_ID,
  portfolioId: PORTFOLIO_ID,
  riskScore: 72,
  riskLevel: 'HIGH',
  summary: 'Portfolio has elevated risk due to tech concentration.',
  factorsJson: [{ factor: 'Sector concentration', weight: 0.4 }],
  adviceJson: [{ advice: 'Diversify into bonds' }],
  disclaimer: 'This is not financial advice.',
  regulatoryFramework: 'SEC',
  createdAt: new Date('2026-03-30T00:00:00Z'),
};

// ── Mock Drizzle DB ────────────────────────────────────────────────────────
function createMockDb() {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  };
  const insertChain = {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([SAMPLE_REPORT]),
  };

  return {
    select: vi.fn().mockReturnValue(selectChain),
    insert: vi.fn().mockReturnValue(insertChain),
    _selectChain: selectChain,
    _insertChain: insertChain,
  };
}

describe('ReportService', () => {
  let service: ReportService;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(async () => {
    mockDb = createMockDb();

    const module = await Test.createTestingModule({
      providers: [
        ReportService,
        { provide: 'DRIZZLE_DB', useValue: mockDb },
      ],
    }).compile();

    service = module.get(ReportService);
  });

  // ── generateReport ──────────────────────────────────────────────────────

  describe('generateReport', () => {
    it('creates a report and returns it', async () => {
      // Portfolio ownership check — return a matching portfolio
      mockDb._selectChain.limit.mockResolvedValueOnce([{ id: PORTFOLIO_ID }]);

      const data: CreateReportData = {
        portfolioId: PORTFOLIO_ID,
        riskScore: 72,
        riskLevel: 'HIGH',
        summary: 'Portfolio has elevated risk due to tech concentration.',
        factorsJson: [{ factor: 'Sector concentration', weight: 0.4 }],
        adviceJson: [{ advice: 'Diversify into bonds' }],
        disclaimer: 'This is not financial advice.',
        regulatoryFramework: 'SEC',
      };

      const result = await service.generateReport(USER_ID, data);

      expect(result).toBeDefined();
      expect(result.id).toBe(REPORT_ID);
      expect(result.riskScore).toBe(72);
      expect(result.riskLevel).toBe('HIGH');
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('throws NotFoundException when portfolio not owned by user', async () => {
      // Portfolio ownership check returns empty
      mockDb._selectChain.limit.mockResolvedValueOnce([]);

      const data: CreateReportData = {
        portfolioId: PORTFOLIO_ID,
        riskScore: 50,
        riskLevel: 'MEDIUM',
      };

      await expect(service.generateReport(USER_ID, data)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── getReport ───────────────────────────────────────────────────────────

  describe('getReport', () => {
    it('returns the report when found and owned', async () => {
      // First select: find report by ID
      mockDb._selectChain.limit.mockResolvedValueOnce([SAMPLE_REPORT]);
      // Second select: verify portfolio ownership
      mockDb._selectChain.limit.mockResolvedValueOnce([{ id: PORTFOLIO_ID }]);

      const result = await service.getReport(USER_ID, REPORT_ID);

      expect(result).toBeDefined();
      expect(result.id).toBe(REPORT_ID);
      expect(result.riskScore).toBe(72);
    });

    it('throws NotFoundException when report not found', async () => {
      mockDb._selectChain.limit.mockResolvedValueOnce([]);

      await expect(service.getReport(USER_ID, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when portfolio not owned', async () => {
      // Report found
      mockDb._selectChain.limit.mockResolvedValueOnce([SAMPLE_REPORT]);
      // But portfolio ownership check fails
      mockDb._selectChain.limit.mockResolvedValueOnce([]);

      await expect(service.getReport(USER_ID, REPORT_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── getReportPdf ────────────────────────────────────────────────────────

  describe('getReportPdf', () => {
    it('returns a Buffer with markdown content', async () => {
      // Report lookup
      mockDb._selectChain.limit.mockResolvedValueOnce([SAMPLE_REPORT]);
      // Portfolio ownership
      mockDb._selectChain.limit.mockResolvedValueOnce([{ id: PORTFOLIO_ID }]);

      const pdf = await service.getReportPdf(USER_ID, REPORT_ID);

      expect(pdf).toBeInstanceOf(Buffer);

      const content = pdf.toString('utf-8');
      expect(content).toContain('# Risk Report');
      expect(content).toContain('Risk Score:** 72');
      expect(content).toContain('Risk Level:** HIGH');
      expect(content).toContain('Summary');
      expect(content).toContain('tech concentration');
      expect(content).toContain('Sector concentration');
      expect(content).toContain('not financial advice');
    });

    it('throws NotFoundException when report not found', async () => {
      mockDb._selectChain.limit.mockResolvedValueOnce([]);

      await expect(service.getReportPdf(USER_ID, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
