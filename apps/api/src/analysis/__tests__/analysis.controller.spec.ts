import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AnalysisController } from '../analysis.controller';

describe('AnalysisController', () => {
  let stockAnalysisService: { streamAnalysis: ReturnType<typeof vi.fn> };
  let configService: { get: ReturnType<typeof vi.fn> };
  let ctrl: AnalysisController;

  const user = { userId: 'u1', username: 'u@x.com' } as never;
  const mockRes = {
    status: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
    write: vi.fn(),
    end: vi.fn(),
  } as never;

  function makeStream(chunks: string[] = []) {
    let idx = 0;
    return {
      getReader: () => ({
        read: async () => {
          if (idx < chunks.length) return { done: false, value: chunks[idx++] };
          return { done: true, value: undefined };
        },
      }),
    } as never;
  }

  beforeEach(() => {
    stockAnalysisService = {
      streamAnalysis: vi.fn().mockResolvedValue(makeStream()),
    };
    configService = { get: vi.fn().mockReturnValue(false) };
    ctrl = new AnalysisController(
      stockAnalysisService as never,
      configService as never,
    );
  });

  it('rejects invalid ticker format', async () => {
    await expect(ctrl.streamAnalysis('BAD TICKER!', user, mockRes)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('streams normally when ANALYSIS_RUNS_ENABLED=false', async () => {
    configService.get.mockReturnValue(false);
    await ctrl.streamAnalysis('AAPL', user, mockRes);
    expect(stockAnalysisService.streamAnalysis).toHaveBeenCalledOnce();
  });

  it('throws BadRequestException when ANALYSIS_RUNS_ENABLED=true', async () => {
    configService.get.mockReturnValue(true);
    await expect(ctrl.streamAnalysis('AAPL', user, mockRes)).rejects.toThrow(
      BadRequestException,
    );
    await expect(ctrl.streamAnalysis('AAPL', user, mockRes)).rejects.toThrow(
      /ANALYSIS_RUNS_ENABLED/,
    );
    expect(stockAnalysisService.streamAnalysis).not.toHaveBeenCalled();
  });
});
