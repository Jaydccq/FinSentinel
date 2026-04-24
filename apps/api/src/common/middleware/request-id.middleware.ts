import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Express Request augmented with a `.id` field set by `requestIdMiddleware`.
 * Use this type at read sites (e.g. the global exception filter) when you
 * need the correlation ID; doing this via a local type avoids needing a
 * project-wide module-augmentation file just for one field.
 */
// After `requestIdMiddleware` runs, `req.id` is guaranteed. pino-http
// augments Express.Request with `id: ReqId` (string), so we make this
// required to stay compatible with pino-http's module augmentation.
export interface RequestWithId extends Request {
  id: string;
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
    (req as RequestWithId).id = id;
    res.setHeader(REQUEST_ID_HEADER, id);
    next();
  };
}
