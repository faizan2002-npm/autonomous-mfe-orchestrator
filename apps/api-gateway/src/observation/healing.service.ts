import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  CognitiveService,
  type PatchGenerationTask,
} from '../cognitive/cognitive.service.js';
import { CanaryService } from '../canary/canary.service.js';

@Injectable()
export class HealingService implements OnModuleDestroy {
  private readonly logger = new Logger(HealingService.name);
  private readonly pending = new Map<string, Promise<void>>();
  private shuttingDown = false;

  constructor(
    @Inject(CognitiveService)
    private readonly cognitiveService: CognitiveService,
    @Inject(CanaryService) private readonly canaryService: CanaryService,
  ) {}

  schedule(task: PatchGenerationTask): void {
    // Coalesce repeated observations while this contract is being healed.
    if (this.shuttingDown || this.pending.has(task.contractId)) return;
    const work = new Promise<void>((resolve) => setImmediate(resolve))
      .then(() => this.heal(task))
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
    if (patch) {
      await this.canaryService.deployPatch(
        task.serviceName,
        patch.patchId,
        patch.adapterCode,
      );
    }
  }
}
