import { createParamDecorator, ExecutionContext } from '@nestjs/common';

const HEADER = 'idempotency-key';

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Pure helper exposed for unit testing.
 * Express lowercases header names; some adapters do not, so check both shapes.
 */
export function extractIdempotencyKey(req: RequestLike): string | undefined {
  const raw = req.headers[HEADER] ?? req.headers['Idempotency-Key' as keyof typeof req.headers];
  if (raw === undefined) return undefined;
  if (Array.isArray(raw)) {
    return raw.find((v) => typeof v === 'string' && v.length > 0);
  }
  return raw.length > 0 ? raw : undefined;
}

/**
 * `@IdempotencyKey()` — injects the `Idempotency-Key` header value (or undefined)
 * into a controller method parameter. Stripe-style, transport-only.
 */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const req = ctx.switchToHttp().getRequest<RequestLike>();
    return extractIdempotencyKey(req);
  },
);
