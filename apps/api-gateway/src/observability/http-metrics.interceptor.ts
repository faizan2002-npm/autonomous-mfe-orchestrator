import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
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
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    // Extract/generate request ID (for backward compatibility)
    const requestId = (request.headers['x-request-id'] as string) || this.generateRequestId();
    (request as any).id = requestId;

    // Extract/generate W3C Trace Context (traceparent header)
    const traceparent = this.extractOrGenerateTraceparent(request);
    (request as any).traceparent = traceparent;

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

  /**
   * Extract W3C Trace Context from incoming request, or generate new trace/span IDs.
   * Format: 00-trace_id-span_id-trace_flags
   * See: https://www.w3.org/TR/trace-context/
   */
  private extractOrGenerateTraceparent(request: Request): string {
    const incoming = request.headers['traceparent'] as string;

    if (incoming && this.isValidTraceparent(incoming)) {
      // Extract trace ID and flags, generate new span ID for this service
      const [version, traceId, , traceFlags] = incoming.split('-');
      const newSpanId = this.generateSpanId();
      return `${version}-${traceId}-${newSpanId}-${traceFlags}`;
    }

    // Generate new trace context if not present
    const traceId = this.generateTraceId();
    const spanId = this.generateSpanId();
    const traceFlags = '01'; // Sampled
    return `00-${traceId}-${spanId}-${traceFlags}`;
  }

  private isValidTraceparent(traceparent: string): boolean {
    const parts = traceparent.split('-');
    return (
      parts.length === 4 &&
      /^[0-9a-f]{2}$/.test(parts[0]) && // version
      /^[0-9a-f]{32}$/.test(parts[1]) && // trace ID
      /^[0-9a-f]{16}$/.test(parts[2]) && // span ID
      /^[0-9a-f]{2}$/.test(parts[3]) // trace flags
    );
  }

  private generateTraceId(): string {
    return Math.random().toString(16).substr(2, 32).padEnd(32, '0');
  }

  private generateSpanId(): string {
    return Math.random().toString(16).substr(2, 16).padEnd(16, '0');
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
