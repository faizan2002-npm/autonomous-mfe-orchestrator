import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
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
  normalizeEndpointPath,
  type ContractRef,
} from '../common/contract-ref.js';
import {
  GATEWAY_CONFIG,
  type GatewayConfig,
} from '../config/gateway-config.js';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import { GatewayEventsService } from '../events/gateway-events.service.js';
import { HealingService } from '../healing/healing.service.js';
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
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
    @Inject(GatewayEventsService) private readonly events: GatewayEventsService,
  ) {
    // A rolled-back patch means the drift is unhandled again: let the next occurrence re-trigger healing.
    this.events.stream().subscribe((event) => {
      if (event.type === 'patch.rolledBack')
        void this.forgetDrift(event.contract).catch((error: unknown) =>
          this.logger.warn(`Could not reset drift memory: ${String(error)}`),
        );
    });
  }

  async observe(response: ObservedResponse): Promise<void> {
    const normalized = {
      ...response,
      endpointPath: normalizeEndpointPath(response.endpointPath),
    };
    const baseline = await this.contracts.getOrCreateBaseline(normalized);
    const drift = assessDrift(
      baseline.schemaTokens,
      response.observedPayload,
      this.config.driftThreshold,
    );
    if (!drift) return;
    // Every request with the same drifted shape would otherwise add an event and a patch.
    if (!(await this.claimDrift(normalized, response.observedPayload))) return;

    this.logger.warn(
      `API drift: ${response.serviceName} ${normalized.endpointPath} (${drift.coefficient.toFixed(2)})`,
    );
    const eventId = await this.recordDrift(normalized, baseline, drift);
    this.events.publish({
      type: 'drift.detected',
      driftEventId: eventId,
      contract: {
        serviceName: normalized.serviceName,
        httpMethod: normalized.httpMethod,
        endpointPath: normalized.endpointPath,
      },
      driftType: drift.type,
      severity: drift.severity,
      coefficient: drift.coefficient,
      isBreaking: drift.isBreaking,
    });
    if (!drift.isBreaking) return;

    this.healing.schedule({
      driftEventId: eventId,
      contractId: baseline.contractId,
      serviceName: normalized.serviceName,
      httpMethod: normalized.httpMethod,
      endpointPath: normalized.endpointPath,
      expectedSchema: baseline.schemaTokens,
      diffDetails: drift.diff,
      samplePayload: response.observedPayload,
    });
  }

  /** True only for the first observation of this schema shape within the TTL. */
  private async claimDrift(
    contract: ContractRef,
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

  private async forgetDrift(contract: ContractRef): Promise<void> {
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

function driftMemoryPrefix(contract: ContractRef): string {
  return `drift_seen:${contractKey(contract)}:`;
}
