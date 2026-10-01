import { DRIZZLE_DB } from '../database/database.tokens.js';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  validateAdapterAst,
  executeInSandbox,
} from '@orchestrator/adapter-runtime';
import type { PatchGenerationTask, SavedPatch } from './patch-generation.js';
export type { PatchGenerationTask } from './patch-generation.js';
import { InferenceService } from './inference.service.js';
import {
  type DrizzleDb,
  patchRegistries,
  governanceAudits,
} from '@orchestrator/database';

@Injectable()
export class CognitiveService {
  private readonly logger = new Logger(CognitiveService.name);

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    @Inject(InferenceService)
    private readonly inferenceService: InferenceService,
  ) {}

  async generateAndValidatePatch(
    task: PatchGenerationTask,
  ): Promise<SavedPatch | null> {
    this.logger.log(
      `Processing cognitive patch generation for drift event: ${task.driftEventId}`,
    );

    const { adapterCode, reasoningTrace } =
      await this.inferenceService.generate(task);

    const astCheck = validateAdapterAst(adapterCode);
    if (!astCheck.valid) {
      this.logger.error(`AST Validation failed: ${astCheck.errors.join(', ')}`);
      return null;
    }

    const sandboxCheck = executeInSandbox(adapterCode, task.samplePayload);
    if (!sandboxCheck.success) {
      this.logger.error(`Sandbox execution failed: ${sandboxCheck.error}`);
      return null;
    }

    this.logger.log(
      `Adapter verified in sandbox (${sandboxCheck.executionTimeMs.toFixed(2)}ms)!`,
    );

    return this.db.transaction(async (tx) => {
      const [patch] = await tx
        .insert(patchRegistries)
        .values({
          contractId: task.contractId,
          driftEventId: task.driftEventId,
          adapterCode,
          adapterSignature: `adapter_${task.serviceName}_v1`,
          confidenceScore: 0.95,
          status: 'CANARY',
          canaryPercent: 10,
        })
        .returning();

      await tx.insert(governanceAudits).values({
        driftEventId: task.driftEventId,
        patchId: patch.id,
        status: 'AUTO_APPROVED',
        reasoningTrace,
        reviewer: 'CognitiveReasoningEngine',
        reviewNotes: 'AST verified and sandboxed pure transformation.',
      });

      return { patchId: patch.id, adapterCode };
    });
  }
}
