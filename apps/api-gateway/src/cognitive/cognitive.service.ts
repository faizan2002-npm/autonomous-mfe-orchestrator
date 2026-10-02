import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  executeInSandbox,
  validateAdapterAst,
} from '@orchestrator/adapter-runtime';
import {
  assessDrift,
  computeJaccardSimilarity,
  flattenPayload,
} from '@orchestrator/core';
import {
  governanceAudits,
  patchRegistries,
  type DrizzleDb,
} from '@orchestrator/database';
import { contractKey } from '../common/contract-ref.js';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import { GatewayEventsService } from '../events/gateway-events.service.js';
import { InferenceService } from './inference.service.js';
import {
  generatorOf,
  type PatchGenerationTask,
  type SavedPatch,
} from './patch-generation.js';

type Verification =
  | { ok: true; confidenceScore: number; executionTimeMs: number }
  | { ok: false; reason: string };

/**
 * Generates an adapter and proves it heals the sample payload. Verified adapters are
 * recorded as VALIDATED; rejected ones as FAILED so reviewers can see why.
 */
@Injectable()
export class CognitiveService {
  private readonly logger = new Logger(CognitiveService.name);

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    @Inject(InferenceService)
    private readonly inferenceService: InferenceService,
    @Inject(GatewayEventsService) private readonly events: GatewayEventsService,
  ) {}

  async generateAndValidatePatch(
    task: PatchGenerationTask,
  ): Promise<SavedPatch | null> {
    this.logger.log(`Generating patch for drift event ${task.driftEventId}`);

    const { adapterCode, reasoningTrace } =
      await this.inferenceService.generate(task);
    const verification = verify(adapterCode, task);
    const contract = {
      serviceName: task.serviceName,
      httpMethod: task.httpMethod,
      endpointPath: task.endpointPath,
    };

    if (!verification.ok) {
      this.logger.error(`Adapter rejected: ${verification.reason}`);
      const patchId = await this.record(task, adapterCode, reasoningTrace, {
        status: 'FAILED',
        confidenceScore: 0,
        auditStatus: 'REJECTED',
        reviewNotes: verification.reason,
      });
      this.events.publish({
        type: 'patch.rejected',
        patchId,
        driftEventId: task.driftEventId,
        contract,
        reason: verification.reason,
      });
      return null;
    }

    const { confidenceScore, executionTimeMs } = verification;
    this.logger.log(
      `Adapter verified in sandbox (${executionTimeMs.toFixed(2)}ms, confidence ${confidenceScore.toFixed(2)})`,
    );
    const patchId = await this.record(task, adapterCode, reasoningTrace, {
      status: 'VALIDATED',
      confidenceScore,
      auditStatus: 'AUTO_APPROVED',
      reviewNotes:
        'AST verified, sandboxed, and shown to restore the expected contract.',
    });
    this.events.publish({
      type: 'patch.generated',
      patchId,
      driftEventId: task.driftEventId,
      contract,
      generator: generatorOf(reasoningTrace),
      confidenceScore,
    });
    return { patchId, adapterCode };
  }

  private record(
    task: PatchGenerationTask,
    adapterCode: string,
    reasoningTrace: string,
    outcome: {
      status: 'VALIDATED' | 'FAILED';
      confidenceScore: number;
      auditStatus: 'AUTO_APPROVED' | 'REJECTED';
      reviewNotes: string;
    },
  ): Promise<string> {
    return this.db.transaction(async (tx) => {
      const [patch] = await tx
        .insert(patchRegistries)
        .values({
          contractId: task.contractId,
          driftEventId: task.driftEventId,
          adapterCode,
          adapterSignature: `adapter:${contractKey(task)}`.slice(0, 255),
          confidenceScore: outcome.confidenceScore,
          status: outcome.status,
        })
        .returning();
      await tx.insert(governanceAudits).values({
        driftEventId: task.driftEventId,
        patchId: patch.id,
        status: outcome.auditStatus,
        reasoningTrace,
        reviewer: 'CognitiveReasoningEngine',
        reviewNotes: outcome.reviewNotes,
      });
      return patch.id;
    });
  }
}

function verify(adapterCode: string, task: PatchGenerationTask): Verification {
  const astCheck = validateAdapterAst(adapterCode);
  if (!astCheck.valid)
    return {
      ok: false,
      reason: `AST validation failed: ${astCheck.errors.join(', ')}`,
    };

  const sandboxCheck = executeInSandbox(adapterCode, task.samplePayload);
  if (!sandboxCheck.success)
    return {
      ok: false,
      reason: `Sandbox execution failed: ${sandboxCheck.error}`,
    };

  // A patch that runs but still breaks the contract must never reach traffic.
  const residual = assessDrift(
    task.expectedSchema,
    sandboxCheck.transformedOutput,
    0,
  );
  if (residual?.isBreaking) {
    const missing = residual.diff.missingFields.join(', ') || 'none';
    const mismatched =
      residual.diff.typeMismatches.map((m) => m.path).join(', ') || 'none';
    return {
      ok: false,
      reason: `Adapter does not restore the contract; still missing ${missing}, mismatched ${mismatched}`,
    };
  }
  return {
    ok: true,
    executionTimeMs: sandboxCheck.executionTimeMs,
    confidenceScore: computeJaccardSimilarity(
      new Set(task.expectedSchema),
      flattenPayload(sandboxCheck.transformedOutput),
    ),
  };
}
