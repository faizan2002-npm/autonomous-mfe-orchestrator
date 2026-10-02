import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CanaryTraffic } from '@orchestrator/shared-types';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.tokens.js';

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

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

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
    return {
      patchedRequests: Number(values.patchedRequests ?? 0),
      adapterFailures: Number(values.adapterFailures ?? 0),
      baselineRequests: Number(values.baselineRequests ?? 0),
    };
  }
}
