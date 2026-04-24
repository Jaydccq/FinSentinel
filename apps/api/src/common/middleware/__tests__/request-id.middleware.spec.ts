import { describe, it, expect, vi } from 'vitest';
import { requestIdMiddleware, REQUEST_ID_HEADER } from '../request-id.middleware';

describe('requestIdMiddleware', () => {
  it('generates a UUID when no incoming X-Request-Id header is present', () => {
    const setHeader = vi.fn();
    const req = { header: vi.fn().mockReturnValue(undefined) } as never;
    const res = { setHeader } as never;
    const next = vi.fn();

    requestIdMiddleware()(req as never, res, next);

    expect((req as { id: string }).id).toMatch(/^[0-9a-f]{8}-/);
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, (req as { id: string }).id);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('honours an incoming X-Request-Id header verbatim', () => {
    const setHeader = vi.fn();
    const req = { header: vi.fn().mockReturnValue('upstream-trace-42') } as never;
    const res = { setHeader } as never;
    const next = vi.fn();

    requestIdMiddleware()(req as never, res, next);

    expect((req as { id: string }).id).toBe('upstream-trace-42');
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, 'upstream-trace-42');
  });

  it('treats empty string header as missing → generates fresh UUID', () => {
    const req = { header: vi.fn().mockReturnValue('') } as never;
    const res = { setHeader: vi.fn() } as never;
    const next = vi.fn();

    requestIdMiddleware()(req as never, res, next);

    expect((req as { id: string }).id).toMatch(/^[0-9a-f]{8}-/);
  });
});
