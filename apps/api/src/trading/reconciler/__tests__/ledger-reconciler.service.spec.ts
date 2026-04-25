import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LedgerReconcilerService } from '../ledger-reconciler.service';
import { OrderLedgerService } from '../../order-ledger/order-ledger.service';
import { BrokerRegistry } from '../../broker-registry.service';
import type { OrderLedgerRow } from '@finsentinel/db';

const NOW = new Date('2026-04-25T00:00:00Z');

function makeRow(overrides: Partial<OrderLedgerRow> = {}): OrderLedgerRow {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    userId: 'u-1',
    commitHash: 'h'.repeat(64),
    idempotencyKey: null,
    status: 'EXECUTING',
    symbol: 'AAPL',
    side: 'buy',
    qty: '10',
    amount: null,
    price: null,
    broker: 'alpaca',
    brokerOrderId: 'BROKER-ORDER-1',
    brokerRequest: {},
    brokerResponse: null,
    errorReason: null,
    createdAt: new Date(NOW.getTime() - 5 * 60_000),
    updatedAt: new Date(NOW.getTime() - 2 * 60_000),
    ...overrides,
  } as OrderLedgerRow;
}

describe('LedgerReconcilerService', () => {
  let service: LedgerReconcilerService;
  let ledger: {
    findStuckExecuting: ReturnType<typeof vi.fn>;
    applyReconcilerOutcome: ReturnType<typeof vi.fn>;
  };
  let registry: { findLiveBrokerById: ReturnType<typeof vi.fn> };
  let cfg: { reconcilerEnabled: boolean; reconcilerStaleAfterMs: number };

  async function build(overrides: Partial<typeof cfg> = {}) {
    cfg = { reconcilerEnabled: true, reconcilerStaleAfterMs: 60_000, ...overrides };
    ledger = {
      findStuckExecuting: vi.fn().mockResolvedValue([]),
      applyReconcilerOutcome: vi.fn().mockResolvedValue(undefined),
    };
    registry = { findLiveBrokerById: vi.fn().mockReturnValue(null) };
    const module = await Test.createTestingModule({
      providers: [
        LedgerReconcilerService,
        { provide: OrderLedgerService, useValue: ledger },
        { provide: BrokerRegistry, useValue: registry },
        {
          provide: ConfigService,
          useValue: { get: (k: string) => (k === 'trading' ? cfg : undefined) },
        },
      ],
    }).compile();
    service = module.get(LedgerReconcilerService);
  }

  beforeEach(async () => {
    await build();
  });

  it('flag OFF: tick handler short-circuits without scanning', async () => {
    await build({ reconcilerEnabled: false });
    await service.tick();
    expect(ledger.findStuckExecuting).not.toHaveBeenCalled();
  });

  it('flag ON, no stuck rows: scan returns zeroes', async () => {
    ledger.findStuckExecuting.mockResolvedValueOnce([]);
    const summary = await service.scan();
    expect(summary).toMatchObject({ scanned: 0, executed: 0, failed: 0, unknown: 0 });
    expect(ledger.applyReconcilerOutcome).not.toHaveBeenCalled();
  });

  it('paper rows → UNKNOWN_REQUIRES_OPERATOR_REVIEW (no broker-side status to query)', async () => {
    ledger.findStuckExecuting.mockResolvedValueOnce([makeRow({ broker: 'paper' })]);
    const summary = await service.scan();
    expect(summary.unknown).toBe(1);
    expect(ledger.applyReconcilerOutcome).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ kind: 'unknown', errorReason: expect.stringMatching(/[Pp]aper/) }),
    );
  });

  it('row with NULL broker_order_id → UNKNOWN', async () => {
    ledger.findStuckExecuting.mockResolvedValueOnce([
      makeRow({ broker: 'alpaca', brokerOrderId: null }),
    ]);
    const summary = await service.scan();
    expect(summary.unknown).toBe(1);
    expect(ledger.applyReconcilerOutcome).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        kind: 'unknown',
        errorReason: expect.stringMatching(/broker_order_id/),
      }),
    );
  });

  it('broker not registered → leave row in EXECUTING, do not transition', async () => {
    ledger.findStuckExecuting.mockResolvedValueOnce([makeRow({ broker: 'alpaca' })]);
    registry.findLiveBrokerById.mockReturnValue(null);
    const summary = await service.scan();
    expect(summary.skippedNoBroker).toBe(1);
    expect(ledger.applyReconcilerOutcome).not.toHaveBeenCalled();
  });

  it('broker without queryOrderStatus → UNKNOWN', async () => {
    ledger.findStuckExecuting.mockResolvedValueOnce([makeRow({ broker: 'alpaca' })]);
    registry.findLiveBrokerById.mockReturnValue({ brokerId: () => 'alpaca' });
    const summary = await service.scan();
    expect(summary.unknown).toBe(1);
    expect(ledger.applyReconcilerOutcome).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        kind: 'unknown',
        errorReason: expect.stringMatching(/does not implement queryOrderStatus/),
      }),
    );
  });

  it('broker says filled → transition to EXECUTED', async () => {
    ledger.findStuckExecuting.mockResolvedValueOnce([makeRow({ broker: 'alpaca' })]);
    registry.findLiveBrokerById.mockReturnValue({
      brokerId: () => 'alpaca',
      queryOrderStatus: vi.fn().mockResolvedValue({
        status: 'filled',
        filledQty: '10.00000000',
        avgPrice: '150.05',
      }),
    });
    const summary = await service.scan();
    expect(summary.executed).toBe(1);
    expect(ledger.applyReconcilerOutcome).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        kind: 'executed',
        filledQty: '10.00000000',
        avgPrice: '150.05',
      }),
    );
  });

  it('broker says rejected → transition to FAILED with errorReason', async () => {
    ledger.findStuckExecuting.mockResolvedValueOnce([makeRow({ broker: 'alpaca' })]);
    registry.findLiveBrokerById.mockReturnValue({
      brokerId: () => 'alpaca',
      queryOrderStatus: vi
        .fn()
        .mockResolvedValue({ status: 'rejected', errorReason: 'insufficient buying power' }),
    });
    const summary = await service.scan();
    expect(summary.failed).toBe(1);
    expect(ledger.applyReconcilerOutcome).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        kind: 'failed',
        errorReason: 'insufficient buying power',
      }),
    );
  });

  it('broker says pending → leave EXECUTING but bump updated_at', async () => {
    ledger.findStuckExecuting.mockResolvedValueOnce([makeRow({ broker: 'alpaca' })]);
    registry.findLiveBrokerById.mockReturnValue({
      brokerId: () => 'alpaca',
      queryOrderStatus: vi.fn().mockResolvedValue({ status: 'pending' }),
    });
    const summary = await service.scan();
    expect(summary.pending).toBe(1);
    expect(ledger.applyReconcilerOutcome).toHaveBeenCalledWith(
      expect.any(String),
      { kind: 'pending' },
    );
  });

  it('broker queryOrderStatus throws → UNKNOWN with thrown reason captured', async () => {
    ledger.findStuckExecuting.mockResolvedValueOnce([makeRow({ broker: 'alpaca' })]);
    registry.findLiveBrokerById.mockReturnValue({
      brokerId: () => 'alpaca',
      queryOrderStatus: vi.fn().mockRejectedValue(new Error('alpaca timeout')),
    });
    const summary = await service.scan();
    expect(summary.unknown).toBe(1);
    expect(ledger.applyReconcilerOutcome).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        kind: 'unknown',
        errorReason: expect.stringMatching(/alpaca timeout/),
      }),
    );
  });

  it('broker says unknown → UNKNOWN with broker reason if provided', async () => {
    ledger.findStuckExecuting.mockResolvedValueOnce([makeRow({ broker: 'alpaca' })]);
    registry.findLiveBrokerById.mockReturnValue({
      brokerId: () => 'alpaca',
      queryOrderStatus: vi
        .fn()
        .mockResolvedValue({ status: 'unknown', errorReason: 'order id not found' }),
    });
    const summary = await service.scan();
    expect(summary.unknown).toBe(1);
    expect(ledger.applyReconcilerOutcome).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ kind: 'unknown', errorReason: 'order id not found' }),
    );
  });

  it('mixed batch: 2 filled + 1 rejected + 1 pending + 1 unknown summary', async () => {
    ledger.findStuckExecuting.mockResolvedValueOnce([
      makeRow({ id: '1', brokerOrderId: 'A1' }),
      makeRow({ id: '2', brokerOrderId: 'A2' }),
      makeRow({ id: '3', brokerOrderId: 'A3' }),
      makeRow({ id: '4', brokerOrderId: 'A4' }),
      makeRow({ id: '5', brokerOrderId: 'A5' }),
    ]);
    const queryOrderStatus = vi
      .fn()
      .mockResolvedValueOnce({ status: 'filled', filledQty: '1', avgPrice: '100' })
      .mockResolvedValueOnce({ status: 'filled', filledQty: '1', avgPrice: '101' })
      .mockResolvedValueOnce({ status: 'rejected', errorReason: 'no funds' })
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValueOnce({ status: 'unknown', errorReason: '404' });
    registry.findLiveBrokerById.mockReturnValue({
      brokerId: () => 'alpaca',
      queryOrderStatus,
    });
    const summary = await service.scan();
    expect(summary).toMatchObject({
      scanned: 5,
      executed: 2,
      failed: 1,
      pending: 1,
      unknown: 1,
      skippedNoBroker: 0,
    });
  });
});
