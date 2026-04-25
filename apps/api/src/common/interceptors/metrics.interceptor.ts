import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { MetricsService } from '../services/metrics.service';

/**
 * Global HTTP interceptor that records request duration and count.
 *
 * Emits:
 *   http_request_duration_seconds  — histogram (method, route, status)
 *   http_requests_total            — counter   (method, route, status)
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest<Request>();
    const route = request.route?.path ?? request.path;
    const method = request.method;

    const endTimer = this.metrics.startHistogramTimer(
      'http_request_duration_seconds',
      'Duration of HTTP requests in seconds',
      { method, route, status: '200' },
      [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    );

    return next.handle().pipe(
      tap({
        next: () => {
          const response = context.switchToHttp().getResponse<Response>();
          const status = String(response.statusCode);
          endTimer();
          this.metrics.incrementCounter(
            'http_requests_total',
            'Total HTTP requests by method, route, and status',
            { method, route, status },
          );
        },
        error: () => {
          endTimer();
          this.metrics.incrementCounter(
            'http_requests_total',
            'Total HTTP requests by method, route, and status',
            { method, route, status: '500' },
          );
        },
      }),
    );
  }
}
