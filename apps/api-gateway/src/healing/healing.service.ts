import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import { CanaryService } from '../canary/canary.service.js';
import { CognitiveService } from '../cognitive/cognitive.service.js';
import type { PatchGenerationTask } from '../cognitive/patch-generation.js';
import { withRedisLock } from '../common/redis-lock.js';
import { REDIS_CLIENT } from '../redis/redis.tokens.js';

/** Runs generate -> deploy in the background, at most once per contract across all instances. */
@Injectable()
export class HealingService implements OnModuleDestroy {
  private readonly logger = new Logger(HealingService.name);
  /** Track pending work for shutdown (don't allow new tasks once shutdown starts). */
  private readonly pending = new Map<string, Promise<void>>();
  private shuttingDown = false;
  /** Healing lock TTL: 30 seconds (same as CognitiveService timeout). */
  private readonly lockTtlMs = 30_000;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(CognitiveService)
    private readonly cognitiveService: CognitiveService,
    @Inject(CanaryService) private readonly canaryService: CanaryService,
  ) {}

  schedule(task: PatchGenerationTask): void {
    if (this.shuttingDown) return;

    // Acquire distributed lock across all instances; if another instance is healing
    // this contract, skip. Otherwise, run the healing task in the background.
    const work = withRedisLock(
      this.redis,
      `healing:${task.contractId}`,
      this.lockTtlMs,
      () => this.heal(task),
    )
      .catch((error: unknown) => {
        this.logger.error(
          `Healing failed for ${task.contractId}: ${String(error)}`,
        );
      })
      .finally(() => this.pending.delete(task.contractId));

    this.pending.set(task.contractId, work);
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    await Promise.all(this.pending.values());
  }

  private async heal(task: PatchGenerationTask): Promise<void> {
    const patch = await this.cognitiveService.generateAndValidatePatch(task);
    if (!patch) return;
    await this.canaryService.deployPatch({
      patchId: patch.patchId,
      contractId: task.contractId,
      contract: {
        orgId: task.orgId,
        consumerId: task.consumerId,
        consumerName: task.consumerName,
        serviceName: task.serviceName,
        httpMethod: task.httpMethod,
        endpointPath: task.endpointPath,
      },
      adapterCode: patch.adapterCode,
    });
  }
}
