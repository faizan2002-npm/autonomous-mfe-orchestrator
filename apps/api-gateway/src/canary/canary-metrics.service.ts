import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CanaryTraffic } from '@orchestrator/shared-types';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.tokens.js';
import { MetricsService } from '../observability/metrics.service.js';

export type CanaryOutcome = 'patched' | 'adapterFailure' | 'baseline';

const RETENTION_SECONDS = 7 * 24 * 3_600;
const FIELDS: Record<CanaryOutcome, keyof CanaryTraffic> = {
  patched: 'patchedRequests',
  adapterFailure: 'adapterFailures',
  baseline: 'baselineRequests',
};

/** Per-patch traffic counters, so reviewers see real canary traffic before promoting. */
@Injectable()
export class CanaryMetricsService {
  private readonly logger = new Logger(CanaryMetricsService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly metrics: MetricsService,
  ) {}

  /** Fire-and-forget: metrics must never slow down or fail a proxied request. */
  record(patchId: string, outcome: CanaryOutcome): void {
    const key = `canary_traffic:${patchId}`;
    this.redis
      .multi()
      .hincrby(key, FIELDS[outcome], 1)
      .expire(key, RETENTION_SECONDS)
      .exec()
      .catch((error: unknown) =>
        this.logger.warn(`Canary metric not recorded: ${String(error)}`),
      );
  }

  async traffic(patchId: string): Promise<CanaryTraffic> {
    const values = await this.redis.hgetall(`canary_traffic:${patchId}`);
    const traffic = {
      patchedRequests: Number(values.patchedRequests ?? 0),
      adapterFailures: Number(values.adapterFailures ?? 0),
      baselineRequests: Number(values.baselineRequests ?? 0),
    };

    // Export to Prometheus
    this.exportMetrics(patchId, traffic);

    return traffic;
  }

  private exportMetrics(patchId: string, traffic: CanaryTraffic): void {
    const canaryErrorRate =
      traffic.patchedRequests > 0
        ? traffic.adapterFailures / traffic.patchedRequests
        : 0;
    const canarySuccessRate = 1 - canaryErrorRate;
    const baselineErrorRate =
      traffic.baselineRequests > 0 ? 0 : 0; // Not tracking baseline in Redis yet
    const ratio = baselineErrorRate > 0 ? canaryErrorRate / baselineErrorRate : canaryErrorRate;

    const labels = { patch_id: patchId, org_id: 'unknown' };

    this.metrics.canarySuccessRate.set(labels, canarySuccessRate);
    this.metrics.canaryErrorRate.set(labels, canaryErrorRate);
    this.metrics.canaryBaselineComparison.set(labels, ratio);
  }
}
