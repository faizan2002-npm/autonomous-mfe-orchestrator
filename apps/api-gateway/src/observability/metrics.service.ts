import { Injectable, Logger } from '@nestjs/common';
import * as promClient from 'prom-client';

/**
 * Prometheus metrics for the API Gateway.
 * Exposes metrics via GET /metrics endpoint for Prometheus scraping.
 */
@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  // One registry per gateway instance, so several gateways can share a process (tests).
  private readonly registry = new promClient.Registry();

  // Patch generation metrics
  readonly patchGenerationDuration = new promClient.Histogram({
    name: 'gateway_patch_generation_duration_seconds',
    help: 'Time to generate and validate a patch',
    registers: [this.registry],
    labelNames: ['org_id', 'outcome'],
    buckets: [0.1, 0.5, 1, 2, 5, 10],
  });

  readonly patchGenerationFailures = new promClient.Counter({
    name: 'gateway_patch_generation_failures_total',
    help: 'Total failed patch generations',
    registers: [this.registry],
    labelNames: ['org_id', 'reason'],
  });

  // Circuit breaker metrics
  readonly circuitBreakerState = new promClient.Gauge({
    name: 'gateway_circuit_breaker_state',
    help: 'Circuit breaker state (0=CLOSED, 1=OPEN, 2=HALF_OPEN)',
    registers: [this.registry],
    labelNames: ['name'],
  });

  // Gemini metrics
  readonly geminiRequests = new promClient.Counter({
    name: 'gateway_gemini_requests_total',
    help: 'Total requests to Gemini API',
    registers: [this.registry],
    labelNames: ['model'],
  });

  readonly geminiTimeouts = new promClient.Counter({
    name: 'gateway_gemini_timeouts_total',
    help: 'Total Gemini timeouts',
    registers: [this.registry],
  });

  readonly geminiDuration = new promClient.Histogram({
    name: 'gateway_gemini_duration_seconds',
    help: 'Gemini API response time',
    registers: [this.registry],
    buckets: [1, 2, 5, 10],
  });

  // Upstream metrics
  readonly upstreamRequests = new promClient.Counter({
    name: 'gateway_upstream_requests_total',
    help: 'Total upstream service requests',
    registers: [this.registry],
    labelNames: ['service', 'method', 'status'],
  });

  readonly upstreamDuration = new promClient.Histogram({
    name: 'gateway_upstream_duration_seconds',
    help: 'Upstream service response time',
    registers: [this.registry],
    labelNames: ['service'],
    buckets: [0.05, 0.1, 0.5, 1, 5],
  });

  readonly upstreamRetries = new promClient.Counter({
    name: 'gateway_upstream_retries_total',
    help: 'Upstream request retries',
    registers: [this.registry],
    labelNames: ['service', 'attempt'],
  });

  // Redis lock metrics
  readonly redisLockContention = new promClient.Gauge({
    name: 'gateway_redis_lock_contention',
    help: 'Estimated # of waiting lock acquires',
    registers: [this.registry],
    labelNames: ['lock_name'],
  });

  readonly redisLockDuration = new promClient.Histogram({
    name: 'gateway_redis_lock_duration_seconds',
    help: 'Duration of held Redis locks',
    registers: [this.registry],
    labelNames: ['lock_name'],
    buckets: [0.01, 0.1, 1, 5],
  });

  // HTTP metrics (set by interceptor)
  readonly httpRequests = new promClient.Counter({
    name: 'gateway_http_requests_total',
    help: 'Total HTTP requests',
    registers: [this.registry],
    labelNames: ['method', 'path', 'status'],
  });

  readonly httpDuration = new promClient.Histogram({
    name: 'gateway_http_duration_seconds',
    help: 'HTTP request duration',
    registers: [this.registry],
    labelNames: ['method', 'path'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
  });

  // Canary metrics
  readonly canarySuccessRate = new promClient.Gauge({
    name: 'gateway_canary_success_rate',
    help: 'Canary patch success rate (0-1)',
    registers: [this.registry],
    labelNames: ['patch_id', 'org_id'],
  });

  readonly canaryErrorRate = new promClient.Gauge({
    name: 'gateway_canary_error_rate',
    help: 'Canary patch error rate (0-1)',
    registers: [this.registry],
    labelNames: ['patch_id', 'org_id'],
  });

  readonly canaryLatency = new promClient.Gauge({
    name: 'gateway_canary_latency_ms',
    help: 'Average latency for canary requests (ms)',
    registers: [this.registry],
    labelNames: ['patch_id', 'org_id'],
  });

  readonly canaryBaselineComparison = new promClient.Gauge({
    name: 'gateway_canary_baseline_ratio',
    help: 'Ratio of canary error rate to baseline error rate',
    registers: [this.registry],
    labelNames: ['patch_id', 'org_id'],
  });

  constructor() {
    this.registerDefaultMetrics();
    this.logger.log('Prometheus metrics initialized');
  }

  private registerDefaultMetrics(): void {
    // Register default Node.js metrics (memory, CPU, etc.)
    promClient.collectDefaultMetrics({ register: this.registry });
  }

  /**
   * Get all metrics in Prometheus text format.
   * Called by GET /metrics endpoint.
   */
  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  /**
   * Reset all metrics (mainly for testing).
   */
  resetMetrics(): void {
    this.registry.resetMetrics();
  }
}
