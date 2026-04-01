import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MarketCalendarService } from '../market-calendar.service';
import { OwnershipDataService } from '../ownership-data.service';
import type { OpenbbPublicDataService } from '../../openbb/openbb-public.service';

/** Shared mock for OpenbbPublicDataService. */
function createOpenbbMock(): OpenbbPublicDataService {
  return {
    queryPublicData: vi.fn().mockResolvedValue({ results: [] }),
  } as unknown as OpenbbPublicDataService;
}

// ── MarketCalendarService ──────────────────────────────────────────────────

describe('MarketCalendarService', () => {
  let service: MarketCalendarService;
  let openbb: ReturnType<typeof createOpenbbMock>;

  beforeEach(() => {
    openbb = createOpenbbMock();
    service = new MarketCalendarService(openbb);
  });

  // ── getEarningsCalendar ──────────────────────────────────────────────────

  describe('getEarningsCalendar', () => {
    it('delegates to OpenBB with correct path', async () => {
      const mockResult = { results: [{ symbol: 'AAPL', date: '2026-04-01' }] };
      (openbb.queryPublicData as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockResult,
      );

      const result = await service.getEarningsCalendar();

      expect(openbb.queryPublicData).toHaveBeenCalledWith(
        'equity/calendar/earnings',
        undefined,
        {},
      );
      expect(result).toEqual(mockResult);
    });

    it('passes date range params when provided', async () => {
      await service.getEarningsCalendar('2026-04-01', '2026-04-30');

      expect(openbb.queryPublicData).toHaveBeenCalledWith(
        'equity/calendar/earnings',
        undefined,
        { start_date: '2026-04-01', end_date: '2026-04-30' },
      );
    });

    it('passes only startDate when endDate is omitted', async () => {
      await service.getEarningsCalendar('2026-04-01');

      expect(openbb.queryPublicData).toHaveBeenCalledWith(
        'equity/calendar/earnings',
        undefined,
        { start_date: '2026-04-01' },
      );
    });

    it('propagates OpenBB errors', async () => {
      (openbb.queryPublicData as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('OpenBB request failed (HTTP 500). Check the path and provider, then try again.'),
      );

      await expect(service.getEarningsCalendar()).rejects.toThrow(
        /OpenBB request failed/,
      );
    });
  });

  // ── getDividendCalendar ──────────────────────────────────────────────────

  describe('getDividendCalendar', () => {
    it('delegates to OpenBB with correct path', async () => {
      await service.getDividendCalendar();

      expect(openbb.queryPublicData).toHaveBeenCalledWith(
        'equity/calendar/dividend',
        undefined,
        {},
      );
    });

    it('passes date range params', async () => {
      await service.getDividendCalendar('2026-01-01', '2026-06-30');

      expect(openbb.queryPublicData).toHaveBeenCalledWith(
        'equity/calendar/dividend',
        undefined,
        { start_date: '2026-01-01', end_date: '2026-06-30' },
      );
    });
  });

  // ── getSplitsCalendar ────────────────────────────────────────────────────

  describe('getSplitsCalendar', () => {
    it('delegates to OpenBB with correct path', async () => {
      await service.getSplitsCalendar();

      expect(openbb.queryPublicData).toHaveBeenCalledWith(
        'equity/calendar/splits',
        undefined,
        {},
      );
    });

    it('passes date range params', async () => {
      await service.getSplitsCalendar('2026-03-01', '2026-03-31');

      expect(openbb.queryPublicData).toHaveBeenCalledWith(
        'equity/calendar/splits',
        undefined,
        { start_date: '2026-03-01', end_date: '2026-03-31' },
      );
    });
  });
});

// ── OwnershipDataService ───────────────────────────────────────────────────

describe('OwnershipDataService', () => {
  let service: OwnershipDataService;
  let openbb: ReturnType<typeof createOpenbbMock>;

  beforeEach(() => {
    openbb = createOpenbbMock();
    service = new OwnershipDataService(openbb);
  });

  // ── getInstitutionalHolders ──────────────────────────────────────────────

  describe('getInstitutionalHolders', () => {
    it('delegates to OpenBB with correct path and uppercase ticker', async () => {
      const mockResult = { results: [{ holder: 'Vanguard', shares: 1000000 }] };
      (openbb.queryPublicData as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockResult,
      );

      const result = await service.getInstitutionalHolders('aapl');

      expect(openbb.queryPublicData).toHaveBeenCalledWith(
        'equity/ownership/institutional',
        undefined,
        { symbol: 'AAPL' },
      );
      expect(result).toEqual(mockResult);
    });

    it('propagates OpenBB errors', async () => {
      (openbb.queryPublicData as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('OpenBB request failed (HTTP 404).'),
      );

      await expect(service.getInstitutionalHolders('AAPL')).rejects.toThrow(
        /OpenBB request failed/,
      );
    });
  });

  // ── getInsiderTransactions ───────────────────────────────────────────────

  describe('getInsiderTransactions', () => {
    it('delegates to OpenBB with correct path and uppercase ticker', async () => {
      const mockResult = { results: [{ insider: 'Tim Cook', type: 'Sale' }] };
      (openbb.queryPublicData as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockResult,
      );

      const result = await service.getInsiderTransactions('msft');

      expect(openbb.queryPublicData).toHaveBeenCalledWith(
        'equity/ownership/insider_trading',
        undefined,
        { symbol: 'MSFT' },
      );
      expect(result).toEqual(mockResult);
    });

    it('propagates OpenBB errors', async () => {
      (openbb.queryPublicData as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Failed to call OpenBB: ECONNREFUSED'),
      );

      await expect(service.getInsiderTransactions('AAPL')).rejects.toThrow(
        /Failed to call OpenBB/,
      );
    });
  });
});
