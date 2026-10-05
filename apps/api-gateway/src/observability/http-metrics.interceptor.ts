import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import type { Response, Request } from 'express';
import { MetricsService } from './metrics.service.js';
import { contextualLogger } from './logger.js';

/**
 * Captures HTTP metrics: request latency, status codes, and errors.
 * Registers context (request ID, org ID) for structured logging.
 */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  private readonly logger = new Logger(HttpMetricsInterceptor.name);

  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    // Extract/generate request ID
    const requestId = (request.headers['x-request-id'] as string) || this.generateRequestId();
    request.id = requestId;

    // Extract org and user from auth context (if available)
    const orgId = (request as any).orgId || '';
    const userId = (request as any).userId || '';

    // Register context for all logs in this request
    contextualLogger.setContext({ requestId, orgId, userId });

    const start = performance.now();
    const method = request.method;
    const path = request.path;

    return next.handle().pipe(
      tap(() => {
        const duration = (performance.now() - start) / 1000; // Convert to seconds
        const status = response.statusCode;

        // Record metrics
        this.metrics.httpRequests.labels(method, path, String(status)).inc();
        this.metrics.httpDuration.labels(method, path).observe(duration);

        // Log successful request
        if (status < 400) {
          contextualLogger.debug('HTTP request completed', {
            method,
            path,
            status,
            duration_ms: Math.round(duration * 1000),
          });
        } else if (status < 500) {
          contextualLogger.warn('HTTP client error', {
            method,
            path,
            status,
            duration_ms: Math.round(duration * 1000),
          });
        }
      }),
      catchError((error: unknown) => {
        const duration = (performance.now() - start) / 1000;
        const status = response.statusCode || 500;

        // Record metrics
        this.metrics.httpRequests.labels(method, path, String(status)).inc();
        this.metrics.httpDuration.labels(method, path).observe(duration);

        // Log error
        contextualLogger.error('HTTP request failed', error, {
          method,
          path,
          status,
          duration_ms: Math.round(duration * 1000),
        });

        throw error; // Re-throw to preserve error handling behavior
      }),
    );
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
