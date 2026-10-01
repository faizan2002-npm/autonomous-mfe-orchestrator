import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  driftEvents,
  serviceRegistries,
  type DrizzleDb,
} from '@orchestrator/database';
import { eq } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import {
  ContractService,
  type ContractBaseline,
  type ObservedResponse,
} from './contract.service.js';
import { assessDrift, type DriftAssessment } from './drift-assessment.js';
import { HealingService } from './healing.service.js';

export type ObservationContext = ObservedResponse;

@Injectable()
export class ObservationService {
  private readonly logger = new Logger(ObservationService.name);

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    @Inject(ContractService) private readonly contracts: ContractService,
    @Inject(HealingService) private readonly healing: HealingService,
  ) {}

  normalizePath(path: string): string {
    return path.replace(/\/\d+(?=\/|$)/g, '/:id');
  }

  async observe(response: ObservationContext): Promise<void> {
    const normalized = {
      ...response,
      endpointPath: this.normalizePath(response.endpointPath),
    };
    const baseline = await this.contracts.getOrCreateBaseline(normalized);
    const drift = assessDrift(
      baseline.schemaTokens,
      response.observedPayload,
      this.getDriftThreshold(),
    );
    if (!drift) return;

    this.logger.warn(
      `API drift: ${response.serviceName} ${normalized.endpointPath} (${drift.coefficient.toFixed(2)})`,
    );
    const eventId = await this.recordDrift(normalized, baseline, drift);
    if (!drift.isBreaking) return;

    this.healing.schedule({
      driftEventId: eventId,
      contractId: baseline.contractId,
      serviceName: response.serviceName,
      endpointPath: normalized.endpointPath,
      expectedSchema: baseline.schemaTokens,
      diffDetails: drift.diff,
      samplePayload: response.observedPayload,
    });
  }

  private getDriftThreshold(): number {
    const configured = process.env.DRIFT_SIMILARITY_THRESHOLD;
    if (configured === undefined || configured.trim() === '') return 0.15;
    const threshold = Number(configured);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      throw new Error('DRIFT_SIMILARITY_THRESHOLD must be between 0 and 1');
    }
    return threshold;
  }

  private async recordDrift(
    response: ObservedResponse,
    baseline: ContractBaseline,
    drift: DriftAssessment,
  ): Promise<string> {
    return this.db.transaction(async (transaction) => {
      const [event] = await transaction
        .insert(driftEvents)
        .values({
          contractId: baseline.contractId,
          serviceId: baseline.serviceId,
          driftType: drift.type,
          severity: drift.severity,
          driftCoefficient: Number(drift.coefficient.toFixed(4)),
          observedPayload: response.observedPayload,
          diffDetails: drift.diff,
          isBreaking: drift.isBreaking,
        })
        .returning();
      await transaction
        .update(serviceRegistries)
        .set({ status: 'DRIFTING' })
        .where(eq(serviceRegistries.id, baseline.serviceId));
      return event.id;
    });
  }
}
