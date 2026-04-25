import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { GlobalExceptionFilter } from '../global-exception.filter';
import type { ErrorResponse } from '../global-exception.filter';

// ── Mock helpers ──────────────────────────────────────────────────────────────

function createMockHost(response: Record<string, unknown>) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({}),
      getResponse: () => response,
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function createMockResponse() {
  const res: Record<string, unknown> = {};
  const jsonFn = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
  const setHeaderFn = vi.fn();
  res['status'] = statusFn;
  res['json'] = jsonFn;
  res['setHeader'] = setHeaderFn;
  return { res, statusFn, jsonFn, setHeaderFn };
}

describe('GlobalExceptionFilter', () => {
  const filter = new GlobalExceptionFilter();

  it('maps BadRequestException with string[] errors to 400 with errors array', () => {
    const { res, statusFn, jsonFn } = createMockResponse();
    const host = createMockHost(res);

    filter.catch(new BadRequestException(['field1: required', 'field2: invalid']), host);

    expect(statusFn).toHaveBeenCalledWith(400);
    const body: ErrorResponse = jsonFn.mock.calls[0]![0];
    expect(body.status).toBe(400);
    expect(body.message).toBe('Validation failed');
    expect(body.errors).toEqual(['field1: required', 'field2: invalid']);
    expect(body.timestamp).toBeDefined();
  });

  it('maps BadRequestException with string message', () => {
    const { res, statusFn, jsonFn } = createMockResponse();
    const host = createMockHost(res);

    filter.catch(new BadRequestException('Invalid input'), host);

    expect(statusFn).toHaveBeenCalledWith(400);
    const body: ErrorResponse = jsonFn.mock.calls[0]![0];
    expect(body.status).toBe(400);
    expect(body.message).toBe('Invalid input');
  });

  it('maps 429 rate limit with Retry-After header', () => {
    const { res, statusFn, jsonFn, setHeaderFn } = createMockResponse();
    const host = createMockHost(res);

    const exception = new HttpException(
      { statusCode: 429, message: 'Too many requests', retryAfterMs: 5000 },
      HttpStatus.TOO_MANY_REQUESTS,
    );

    filter.catch(exception, host);

    expect(statusFn).toHaveBeenCalledWith(429);
    expect(setHeaderFn).toHaveBeenCalledWith('Retry-After', 5);
    const body: ErrorResponse = jsonFn.mock.calls[0]![0];
    expect(body.retryAfterMs).toBe(5000);
  });

  it('maps NotFoundException to 404', () => {
    const { res, statusFn, jsonFn } = createMockResponse();
    const host = createMockHost(res);

    filter.catch(new NotFoundException('Resource not found'), host);

    expect(statusFn).toHaveBeenCalledWith(404);
    const body: ErrorResponse = jsonFn.mock.calls[0]![0];
    expect(body.status).toBe(404);
    expect(body.message).toBe('Resource not found');
  });

  it('maps unhandled Error to 500 with generic message', () => {
    const { res, statusFn, jsonFn } = createMockResponse();
    const host = createMockHost(res);

    filter.catch(new Error('database connection failed'), host);

    expect(statusFn).toHaveBeenCalledWith(500);
    const body: ErrorResponse = jsonFn.mock.calls[0]![0];
    expect(body.status).toBe(500);
    expect(body.message).toBe('Internal server error');
    // Must NOT leak internal error details
    expect(body.errors).toBeUndefined();
  });

  it('maps non-Error unknown exception to 500', () => {
    const { res, statusFn, jsonFn } = createMockResponse();
    const host = createMockHost(res);

    filter.catch('string error', host);

    expect(statusFn).toHaveBeenCalledWith(500);
    const body: ErrorResponse = jsonFn.mock.calls[0]![0];
    expect(body.status).toBe(500);
    expect(body.message).toBe('Internal server error');
  });

  it('maps generic HttpException preserving status code', () => {
    const { res, statusFn, jsonFn } = createMockResponse();
    const host = createMockHost(res);

    filter.catch(new HttpException('Forbidden resource', HttpStatus.FORBIDDEN), host);

    expect(statusFn).toHaveBeenCalledWith(403);
    const body: ErrorResponse = jsonFn.mock.calls[0]![0];
    expect(body.status).toBe(403);
    expect(body.message).toBe('Forbidden resource');
  });
});
