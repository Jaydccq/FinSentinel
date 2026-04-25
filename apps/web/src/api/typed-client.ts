// IMPORTANT: type-import zod through `@finsentinel/shared`. The web app
// does not declare zod as a direct dependency, so node module resolution
// can find a different zod copy in a parent node_modules — that creates
// two distinct ZodType brands and breaks composition with shared schemas.
// See `packages/shared/src/index.ts` for the matching value-side fix.
import type { z, ZodTypeAny } from '@finsentinel/shared';
import { apiFetch, ApiError } from './client';

/**
 * Thrown when the API response fails Zod validation. The wrapper does not
 * fall back to the raw payload — callers must surface the schema drift so
 * we can fix it (either a stale schema or a wire-format change).
 */
export class ResponseValidationError extends Error {
  constructor(
    public readonly path: string,
    public readonly issues: unknown,
  ) {
    super(`Response validation failed for ${path}`);
    this.name = 'ResponseValidationError';
  }
}

/**
 * Thrown when the request body fails the route's request Zod schema before
 * the network call is made. Catches client-side bugs early instead of
 * sending a 400 round-trip.
 */
export class RequestValidationError extends Error {
  constructor(
    public readonly path: string,
    public readonly issues: unknown,
  ) {
    super(`Request validation failed for ${path}`);
    this.name = 'RequestValidationError';
  }
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface TypedFetchArgs<
  TReqSchema extends ZodTypeAny | undefined,
  TResSchema extends ZodTypeAny,
> {
  path: string;
  method: HttpMethod;
  responseSchema: TResSchema;
  requestSchema?: TReqSchema;
  body?: TReqSchema extends ZodTypeAny ? z.infer<TReqSchema> : unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

function buildPath(
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): string {
  if (!query) return path;
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) search.set(k, String(v));
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

export async function typedFetch<
  TReqSchema extends ZodTypeAny | undefined,
  TResSchema extends ZodTypeAny,
>(args: TypedFetchArgs<TReqSchema, TResSchema>): Promise<z.infer<TResSchema>> {
  const { path, method, responseSchema, requestSchema, body, query } = args;

  if (requestSchema && body !== undefined) {
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      throw new RequestValidationError(path, parsed.error.issues);
    }
  }

  const init: RequestInit = { method };
  if (body !== undefined && method !== 'GET') {
    init.body = JSON.stringify(body);
  }

  const raw = await apiFetch<unknown>(buildPath(path, query), init);

  if (raw === undefined) {
    // 204 / no-content path — schema must accept undefined explicitly.
    const parsed = responseSchema.safeParse(undefined);
    if (!parsed.success) {
      throw new ResponseValidationError(path, parsed.error.issues);
    }
    return parsed.data as z.infer<TResSchema>;
  }

  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ResponseValidationError(path, parsed.error.issues);
  }
  return parsed.data as z.infer<TResSchema>;
}

export { ApiError };
