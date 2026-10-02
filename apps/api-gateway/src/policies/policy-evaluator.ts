import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { canaryMetrics, type DrizzleDb } from '@orchestrator/database';
import type { PolicyDecision } from '@orchestrator/shared-types';
import { Redis } from 'ioredis';
import { CanaryMetricsService } from '../canary/canary-metrics.service.js';
import { withRedisLock } from '../common/redis-lock.js';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import { GovernanceService } from '../governance/governance.service.js';
import { REDIS_CLIENT } from '../redis/redis.tokens.js';
import { decide, matchPolicy } from './policy-decision.js';
import { PoliciesService } from './policies.service.js';

const INTERVAL_MS = 30_000;
const LOCK_KEY = 'orchestrator:lock:policy-evaluator';

export interface EvaluationResult {
  patchId: string;
  policy: string;
  decision: PolicyDecision;
  applied: boolean;
}

/**
 * Applies promotion policies to canary patches every 30 s. A Redis lock makes exactly one
 * gateway instance evaluate at a time; promotions go through the same audited paths a
 * reviewer uses, recorded as `policy:<name>`.
 */
@Injectable()
export class PolicyEvaluator implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PolicyEvaluator.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<unknown>;

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(PoliciesService) private readonly policies: PoliciesService,
    @Inject(CanaryMetricsService) private readonly metrics: CanaryMetricsService,
    @Inject(GovernanceService) private readonly governance: GovernanceService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      if (!this.running)
        this.running = this.run()
          .catch((error: unknown) => this.logger.error(`Policy evaluation failed: ${String(error)}`))
          .finally(() => (this.running = undefined));
    }, INTERVAL_MS);
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }

  /** One evaluation pass under the cluster-wide lock; undefined when another instance holds it. */
  run(): Promise<EvaluationResult[] | undefined> {
    return withRedisLock(this.redis, LOCK_KEY, INTERVAL_MS, () => this.evaluate());
  }

  private async evaluate(): Promise<EvaluationResult[]> {
    const patches = await this.policies.canaryPatches();
    const policies = await this.policies.enabledPolicies([...new Set(patches.map((p) => p.orgId))]);
    const results: EvaluationResult[] = [];
    for (const patch of patches) {
      const policy = matchPolicy(
        policies.filter((candidate) => candidate.orgId === patch.orgId),
        patch.serviceId,
        patch.consumerId,
      );
      if (!policy) continue;
      const traffic = await this.metrics.traffic(patch.patchId);
      const decision = decide(policy, traffic, patch.deployedAt, patch.generator);
      let applied = false;
      if (decision.action === 'promote' || decision.action === 'rollback') {
        try {
          await this.governance.applyPolicyDecision(
            patch.orgId,
            patch.patchId,
            patch.serviceName,
            decision.action,
            policy.name,
            decision.reason,
          );
          applied = true;
          this.logger.log(`Policy "${policy.name}" ${decision.action}d patch ${patch.patchId}.`);
        } catch (error) {
          // A reviewer may have decided in the meantime (409); the next pass sees the new state.
          this.logger.warn(`Policy ${decision.action} of ${patch.patchId} skipped: ${String(error)}`);
        }
        // The evidence behind every automatic decision, kept with the patch.
        if (applied)
          await this.db.insert(canaryMetrics).values({
            patchId: patch.patchId,
            windowStart: patch.deployedAt ?? new Date(),
            windowEnd: new Date(),
            baselineRequests: traffic.baselineRequests,
            baselineErrors: 0,
            canaryRequests: decision.progress.canaryRequests,
            canaryErrors: traffic.adapterFailures,
            avgLatencyMs: 0,
            promoted: decision.action === 'promote',
            evaluationNotes: decision.reason,
          });
      }
      results.push({ patchId: patch.patchId, policy: policy.name, decision, applied });
    }
    return results;
  }
}
