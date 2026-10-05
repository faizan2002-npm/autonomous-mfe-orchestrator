import { Inject, Injectable } from '@nestjs/common';
import {
  governanceAudits,
  type DrizzleDb,
  type PatchRegistry,
} from '@orchestrator/database';
import type { GovernanceStatus } from '@orchestrator/shared-types';
import type { AuthenticatedUser } from '../auth/token-verifier.js';
import { CanaryService } from '../canary/canary.service.js';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { PatchDecisionDto } from './patch-decision.dto.js';

/** Human oversight of the healing loop: audited promote/rollback decisions. */
@Injectable()
export class GovernanceService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    @Inject(CanaryService) private readonly canaryService: CanaryService,
  ) {}

  async promotePatch(
    orgId: string,
    patchId: string,
    decision: PatchDecisionDto,
    reviewer: AuthenticatedUser,
  ): Promise<void> {
    const patch = await this.canaryService.promotePatch(
      orgId,
      patchId,
      decision.serviceName,
    );
    await this.audit(
      patch,
      'APPROVED',
      'Promoted from canary to 100% traffic.',
      decision,
      reviewer,
    );
  }

  async rollbackPatch(
    orgId: string,
    patchId: string,
    decision: PatchDecisionDto,
    reviewer: AuthenticatedUser,
  ): Promise<void> {
    const patch = await this.canaryService.rollbackPatch(
      orgId,
      patchId,
      decision.serviceName,
    );
    await this.audit(
      patch,
      'REJECTED',
      'Rolled back; upstream responses pass through unpatched.',
      decision,
      reviewer,
    );
  }

  /** A promotion policy's automatic decision, audited under `policy:<name>`. */
  async applyPolicyDecision(
    orgId: string,
    patchId: string,
    serviceName: string,
    action: 'promote' | 'rollback',
    policyName: string,
    reasoning: string,
  ): Promise<PatchRegistry> {
    const patch =
      action === 'promote'
        ? await this.canaryService.promotePatch(orgId, patchId, serviceName, policyName)
        : await this.canaryService.rollbackPatch(orgId, patchId, serviceName, policyName);
    await this.db.insert(governanceAudits).values({
      orgId: patch.orgId,
      driftEventId: patch.driftEventId,
      patchId: patch.id,
      status: action === 'promote' ? 'APPROVED' : 'REJECTED',
      reasoningTrace: reasoning,
      reviewer: `policy:${policyName}`,
      reviewNotes: action === 'promote' ? 'Promoted automatically by policy.' : 'Rolled back automatically by policy.',
      reviewedAt: new Date(),
    });
    return patch;
  }

  private async audit(
    patch: PatchRegistry,
    status: GovernanceStatus,
    reasoningTrace: string,
    decision: PatchDecisionDto,
    reviewer: AuthenticatedUser,
  ): Promise<void> {
    await this.db.insert(governanceAudits).values({
      orgId: patch.orgId,
      driftEventId: patch.driftEventId,
      patchId: patch.id,
      status,
      reasoningTrace,
      // The verified identity, never a client-supplied name.
      reviewer: reviewer.email ?? reviewer.id,
      reviewNotes: decision.notes,
      reviewedAt: new Date(),
    });
  }
}
