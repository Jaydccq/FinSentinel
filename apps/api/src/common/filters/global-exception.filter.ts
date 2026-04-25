import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { REQUEST_ID_HEADER, type RequestWithId } from '../middleware/request-id.middleware';

/**
 * Response envelope returned by the global exception filter.
 */
export interface ErrorResponse {
  timestamp: string;
  status: number;
  message: string;
  errors?: string[];
  retryAfterMs?: number;
}

/**
 * Global exception filter that maps all thrown exceptions to a uniform
 * JSON envelope format.
 *
 * Handling:
 * - BadRequestException (validation) -> 400 with field-level `errors` array
 * - HttpException (429) -> 429 with `Retry-After` header and `retryAfterMs`
 * - HttpException (other) -> its status code + message
 * - Unknown / unhandled -> 500 with generic message (no internals leaked)
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = (request as RequestWithId).id;

    // Echo the correlation id on the error response too. The middleware also
    // sets it; setHeader is idempotent.
    if (requestId) {
      response.setHeader(REQUEST_ID_HEADER, requestId);
    }

    const body: ErrorResponse = {
      timestamp: new Date().toISOString(),
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    };

    if (exception instanceof HttpException) {
      body.status = exception.getStatus();

      const exceptionResponse = exception.getResponse();

      // ── BadRequestException with field-level errors ────────────────
      if (exception instanceof BadRequestException) {
        body.message = 'Validation failed';

        if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
          const resp = exceptionResponse as Record<string, unknown>;

          // ZodValidationPipe throws BadRequestException(messages: string[])
          // NestJS wraps it as { statusCode, message: string | string[], error }
          if (Array.isArray(resp['message'])) {
            body.errors = resp['message'] as string[];
          } else if (typeof resp['message'] === 'string') {
            body.message = resp['message'];
          }
        } else if (typeof exceptionResponse === 'string') {
          body.message = exceptionResponse;
        }
      }
      // ── Rate limit 429 ────────────────────────────────────────────
      else if (body.status === HttpStatus.TOO_MANY_REQUESTS) {
        body.message = 'Too many requests';

        if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
          const resp = exceptionResponse as Record<string, unknown>;
          if (typeof resp['retryAfterMs'] === 'number') {
            body.retryAfterMs = resp['retryAfterMs'];
            const retryAfterSecs = Math.ceil((resp['retryAfterMs'] as number) / 1000);
            response.setHeader('Retry-After', retryAfterSecs);
          }
          if (typeof resp['message'] === 'string') {
            body.message = resp['message'];
          }
        }
      }
      // ── Generic HttpException ─────────────────────────────────────
      else {
        if (typeof exceptionResponse === 'string') {
          body.message = exceptionResponse;
        } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
          const resp = exceptionResponse as Record<string, unknown>;
          body.message = typeof resp['message'] === 'string' ? resp['message'] : exception.message;
        }
      }
    } else {
      // Unhandled exception — log the full error, return generic message
      this.logger.error(
        `Unhandled exception (requestId=${requestId ?? 'unknown'})`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(body.status).json(body);
  }
}
