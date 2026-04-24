import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

declare module 'express-serve-static-core' {
  interface Request {
    /** Per-request correlation ID (set by requestIdMiddleware). */
    id?: string;
  }
}

/**
 * Reads `X-Request-Id` from the incoming request (if present) or generates a
 * fresh UUID. The id is stashed on `req.id` and echoed back via response
 * header so callers can correlate logs across services.
 *
 * Mounted before any other middleware in main.ts so every downstream
 * log/header gets the correlation id.
 */
export function requestIdMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const incoming = req.header(REQUEST_ID_HEADER);
    const id = incoming && incoming.length > 0 ? incoming : randomUUID();
    req.id = id;
    res.setHeader(REQUEST_ID_HEADER, id);
    next();
  };
}
