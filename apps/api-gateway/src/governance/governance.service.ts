import { Inject, Injectable } from '@nestjs/common';
import {
  driftEvents,
  governanceAudits,
  patchRegistries,
  serviceRegistries,
  type DrizzleDb,
  type PatchRegistry,
} from '@orchestrator/database';
import type { GovernanceStatus } from '@orchestrator/shared-types';
import { desc } from 'drizzle-orm';
import type { AuthenticatedUser } from '../auth/token-verifier.js';
import { CanaryService } from '../canary/canary.service.js';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { PatchDecisionDto } from './patch-decision.dto.js';

/** Human oversight of the healing loop: visibility plus audited promote/rollback decisions. */
@Injectable()
export class GovernanceService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    @Inject(CanaryService) private readonly canaryService: CanaryService,
  ) {}

  async getOverview() {
    const [services, events, patches, audits] = await Promise.all([
      this.db.select().from(serviceRegistries),
      this.db
        .select()
        .from(driftEvents)
        .orderBy(desc(driftEvents.detectedAt))
        .limit(20),
      this.db
        .select()
        .from(patchRegistries)
        .orderBy(desc(patchRegistries.createdAt))
        .limit(10),
      this.db
        .select()
        .from(governanceAudits)
        .orderBy(desc(governanceAudits.createdAt))
        .limit(10),
    ]);

    return { services, driftEvents: events, patches, audits };
  }

  async promotePatch(
    patchId: string,
    decision: PatchDecisionDto,
    reviewer: AuthenticatedUser,
  ): Promise<void> {
    const patch = await this.canaryService.promotePatch(
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
    patchId: string,
    decision: PatchDecisionDto,
    reviewer: AuthenticatedUser,
  ): Promise<void> {
    const patch = await this.canaryService.rollbackPatch(
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

  private async audit(
    patch: PatchRegistry,
    status: GovernanceStatus,
    reasoningTrace: string,
    decision: PatchDecisionDto,
    reviewer: AuthenticatedUser,
  ): Promise<void> {
    await this.db.insert(governanceAudits).values({
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
