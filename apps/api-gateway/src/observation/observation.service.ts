import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  applyPins,
  assessDrift,
  flattenPayload,
  type DriftAssessment,
} from '@orchestrator/core';
import {
  driftEvents,
  serviceRegistries,
  type DrizzleDb,
} from '@orchestrator/database';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import {
  contractKey,
  contractView,
  normalizeEndpointPath,
  type ContractRef,
} from '../common/contract-ref.js';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import { GatewayEventsService } from '../events/gateway-events.service.js';
import { HealingService } from '../healing/healing.service.js';
import { OrgSettingsService } from '../orgs/org-settings.service.js';
import { REDIS_CLIENT } from '../redis/redis.tokens.js';
import {
  ContractService,
  type ContractBaseline,
  type ObservedResponse,
} from './contract.service.js';

/** How long one drifted schema shape is considered handled before it is re-reported. */
const DRIFT_DEDUP_TTL_SECONDS = 3_600;

@Injectable()
export class ObservationService {
  private readonly logger = new Logger(ObservationService.name);

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(ContractService) private readonly contracts: ContractService,
    @Inject(HealingService) private readonly healing: HealingService,
    @Inject(OrgSettingsService) private readonly settings: OrgSettingsService,
    @Inject(GatewayEventsService) private readonly events: GatewayEventsService,
  ) {
    // A rolled-back patch means the drift is unhandled again: let the next occurrence re-trigger healing.
    this.events.stream().subscribe((event) => {
      if (event.type === 'patch.rolledBack')
        void this.forgetDrift({ ...event.contract, orgId: event.orgId }).catch(
          (error: unknown) =>
            this.logger.warn(`Could not reset drift memory: ${String(error)}`),
        );
    });
  }

  async observe(response: ObservedResponse): Promise<void> {
    const normalized = {
      ...response,
      endpointPath: normalizeEndpointPath(response.endpointPath),
    };
    const [baseline, settings] = await Promise.all([
      this.contracts.getOrCreateBaseline(normalized),
      this.settings.effective(response.orgId),
    ]);
    const drift = assessDrift(
      baseline.schemaTokens,
      response.observedPayload,
      settings.driftThreshold,
      baseline.pinnedFields,
    );
    if (!drift) return;
    // Every request with the same drifted shape would otherwise add an event and a patch.
    if (!(await this.claimDrift(normalized, response.observedPayload))) return;

    this.logger.warn(
      `API drift: ${response.serviceName} ${normalized.endpointPath} for ${response.consumerName} (${drift.coefficient.toFixed(2)})`,
    );
    const eventId = await this.recordDrift(normalized, baseline, drift);
    this.events.publish({
      type: 'drift.detected',
      orgId: normalized.orgId,
      driftEventId: eventId,
      contract: contractView(normalized),
      driftType: drift.type,
      severity: drift.severity,
      coefficient: drift.coefficient,
      isBreaking: drift.isBreaking,
    });
    if (!drift.isBreaking) return;

    this.healing.schedule({
      driftEventId: eventId,
      contractId: baseline.contractId,
      orgId: normalized.orgId,
      consumerId: normalized.consumerId,
      consumerName: normalized.consumerName,
      serviceName: normalized.serviceName,
      httpMethod: normalized.httpMethod,
      endpointPath: normalized.endpointPath,
      expectedSchema: [
        ...applyPins(baseline.schemaTokens, baseline.pinnedFields),
      ],
      diffDetails: drift.diff,
      samplePayload: response.observedPayload,
    });
  }

  /** True only for the first observation of this schema shape within the TTL. */
  private async claimDrift(
    contract: Omit<ContractRef, 'consumerName'>,
    payload: unknown,
  ): Promise<boolean> {
    const fingerprint = createHash('sha256')
      .update([...flattenPayload(payload)].sort().join('\n'))
      .digest('hex');
    const claimed = await this.redis.set(
      `${driftMemoryPrefix(contract)}${fingerprint}`,
      '1',
      'EX',
      DRIFT_DEDUP_TTL_SECONDS,
      'NX',
    );
    return claimed === 'OK';
  }

  private async forgetDrift(
    contract: Omit<ContractRef, 'consumerName'>,
  ): Promise<void> {
    const keys: string[] = [];
    for await (const batch of this.redis.scanStream({
      match: `${driftMemoryPrefix(contract)}*`,
    }))
      keys.push(...(batch as string[]));
    if (keys.length) await this.redis.del(keys);
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
          orgId: response.orgId,
          consumerId: response.consumerId,
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
        .set({ status: 'DRIFTING', updatedAt: new Date() })
        .where(eq(serviceRegistries.id, baseline.serviceId));
      return event.id;
    });
  }
}

function driftMemoryPrefix(
  contract: Omit<ContractRef, 'consumerName'>,
): string {
  return `drift_seen:${contractKey(contract)}:`;
}
