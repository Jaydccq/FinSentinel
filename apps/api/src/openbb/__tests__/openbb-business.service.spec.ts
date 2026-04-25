import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { OpenbbBusinessDataService } from '../openbb-business.service';
import { OpenbbPublicDataService } from '../openbb-public.service';

describe('OpenbbBusinessDataService', () => {
  let service: OpenbbBusinessDataService;
  let mockPublicService: {
    queryPublicData: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockPublicService = {
      queryPublicData: vi.fn().mockResolvedValue({ results: [] }),
    };

    const module = await Test.createTestingModule({
      providers: [
        OpenbbBusinessDataService,
        {
          provide: OpenbbPublicDataService,
          useValue: mockPublicService,
        },
      ],
    }).compile();

    service = module.get(OpenbbBusinessDataService);
  });

  // ── getUsCpi ──────────────────────────────────────────────────────────────

  describe('getUsCpi', () => {
    it('delegates to public service with correct path and series ID', async () => {
      mockPublicService.queryPublicData.mockResolvedValue({ ok: true });

      const result = await service.getUsCpi();

      expect(result).toEqual({ ok: true });
      expect(mockPublicService.queryPublicData).toHaveBeenCalledWith('economy/cpi', 'fred', {
        series_id: 'CPIAUCSL',
      });
    });

    it('passes date range params when provided', async () => {
      await service.getUsCpi('2020-01-01', '2021-12-31');

      expect(mockPublicService.queryPublicData).toHaveBeenCalledWith('economy/cpi', 'fred', {
        series_id: 'CPIAUCSL',
        start_date: '2020-01-01',
        end_date: '2021-12-31',
      });
    });

    it('passes limit param when provided', async () => {
      await service.getUsCpi(undefined, undefined, 12);

      expect(mockPublicService.queryPublicData).toHaveBeenCalledWith('economy/cpi', 'fred', {
        series_id: 'CPIAUCSL',
        limit: '12',
      });
    });

    it('passes all params together', async () => {
      await service.getUsCpi('2020-01-01', '2021-12-31', 24);

      expect(mockPublicService.queryPublicData).toHaveBeenCalledWith('economy/cpi', 'fred', {
        series_id: 'CPIAUCSL',
        start_date: '2020-01-01',
        end_date: '2021-12-31',
        limit: '24',
      });
    });
  });

  // ── getUsUnemploymentRate ────────────────────────────────────────────────

  describe('getUsUnemploymentRate', () => {
    it('delegates with correct path and series ID', async () => {
      await service.getUsUnemploymentRate();

      expect(mockPublicService.queryPublicData).toHaveBeenCalledWith(
        'economy/unemployment',
        'fred',
        { series_id: 'UNRATE' },
      );
    });

    it('passes date range params when provided', async () => {
      await service.getUsUnemploymentRate('2020-01-01', '2021-01-01');

      expect(mockPublicService.queryPublicData).toHaveBeenCalledWith(
        'economy/unemployment',
        'fred',
        {
          series_id: 'UNRATE',
          start_date: '2020-01-01',
          end_date: '2021-01-01',
        },
      );
    });
  });

  // ── getUsFedFundsRate ───────────────────────────────────────────────────

  describe('getUsFedFundsRate', () => {
    it('delegates with correct path and series ID', async () => {
      await service.getUsFedFundsRate();

      expect(mockPublicService.queryPublicData).toHaveBeenCalledWith(
        'economy/federal_funds_rate',
        'fred',
        { series_id: 'FEDFUNDS' },
      );
    });

    it('passes limit param when provided', async () => {
      await service.getUsFedFundsRate(undefined, undefined, 6);

      expect(mockPublicService.queryPublicData).toHaveBeenCalledWith(
        'economy/federal_funds_rate',
        'fred',
        {
          series_id: 'FEDFUNDS',
          limit: '6',
        },
      );
    });
  });

  // ── Error propagation ──────────────────────────────────────────────────

  describe('error propagation', () => {
    it('propagates errors from public service', async () => {
      mockPublicService.queryPublicData.mockRejectedValue(
        new Error('OpenBB request failed (HTTP 500)'),
      );

      await expect(service.getUsCpi()).rejects.toThrow('OpenBB request failed (HTTP 500)');
    });
  });
});
