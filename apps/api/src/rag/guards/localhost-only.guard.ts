import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/**
 * Localhost-only guard for the RAG eval endpoint.
 *
 * The eval endpoint (`/api/rag/search`) is intended exclusively for the
 * local evaluation runner. It bypasses auth on purpose, so the only
 * defenses are:
 *
 *   1. The `RAG_EVAL_ENDPOINT_ENABLED` env flag (set in the controller).
 *   2. This guard, which restricts callers to the loopback interface
 *      and rejects any request carrying `X-Forwarded-For`. The presence
 *      of XFF means the request traversed a proxy — legit local eval
 *      tooling never sets that header, so its presence indicates either
 *      a misconfiguration or an attempted spoof.
 *
 * Decision recorded in:
 *   docs/exec-plans/2026-04-24-codebase-optimization-triage-prd.md §5 Q1.
 */
const LOCALHOST_ADDRESSES = new Set<string>(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

@Injectable()
export class LocalhostOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      ip?: string;
      socket?: { remoteAddress?: string };
      headers?: Record<string, string | string[] | undefined>;
    }>();

    const xff = request?.headers?.['x-forwarded-for'];
    if (xff !== undefined && xff !== null && xff !== '') {
      throw new ForbiddenException('Eval endpoint is localhost-only');
    }

    const remote =
      (typeof request?.ip === 'string' && request.ip.length > 0 ? request.ip : undefined) ??
      request?.socket?.remoteAddress;

    if (!remote || !LOCALHOST_ADDRESSES.has(remote)) {
      throw new ForbiddenException('Eval endpoint is localhost-only');
    }

    return true;
  }
}
