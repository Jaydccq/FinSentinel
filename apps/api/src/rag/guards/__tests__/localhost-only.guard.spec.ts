import { describe, it, expect } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { LocalhostOnlyGuard } from '../localhost-only.guard';

interface FakeRequest {
  ip?: string;
  socket?: { remoteAddress?: string };
  headers?: Record<string, string | string[] | undefined>;
}

function makeContext(request: FakeRequest): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

describe('LocalhostOnlyGuard', () => {
  const guard = new LocalhostOnlyGuard();

  it('allows IPv4 loopback (127.0.0.1)', () => {
    expect(
      guard.canActivate(makeContext({ ip: '127.0.0.1', headers: {} })),
    ).toBe(true);
  });

  it('allows IPv6 loopback (::1)', () => {
    expect(guard.canActivate(makeContext({ ip: '::1', headers: {} }))).toBe(
      true,
    );
  });

  it('allows IPv4-mapped IPv6 loopback (::ffff:127.0.0.1)', () => {
    expect(
      guard.canActivate(
        makeContext({ ip: '::ffff:127.0.0.1', headers: {} }),
      ),
    ).toBe(true);
  });

  it('rejects non-loopback IPs (10.0.0.5)', () => {
    expect(() =>
      guard.canActivate(makeContext({ ip: '10.0.0.5', headers: {} })),
    ).toThrow(ForbiddenException);
    expect(() =>
      guard.canActivate(makeContext({ ip: '10.0.0.5', headers: {} })),
    ).toThrow('Eval endpoint is localhost-only');
  });

  it('rejects loopback when X-Forwarded-For header is present', () => {
    expect(() =>
      guard.canActivate(
        makeContext({
          ip: '127.0.0.1',
          headers: { 'x-forwarded-for': '1.2.3.4' },
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('falls back to socket.remoteAddress when request.ip is missing', () => {
    expect(
      guard.canActivate(
        makeContext({
          socket: { remoteAddress: '127.0.0.1' },
          headers: {},
        }),
      ),
    ).toBe(true);
  });
});
