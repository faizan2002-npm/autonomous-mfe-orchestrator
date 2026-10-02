import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { executeInSandbox } from '@orchestrator/adapter-runtime';
import {
  apiContracts,
  patchRegistries,
  serviceRegistries,
  type DrizzleDb,
  type PatchRegistry,
} from '@orchestrator/database';
import type { PatchStatus } from '@orchestrator/shared-types';
import { and, eq, inArray, ne } from 'drizzle-orm';
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
import { CanaryMetricsService } from './canary-metrics.service.js';

export interface DeployablePatch {
  patchId: string;
  contractId: string;
  contract: ContractRef;
  adapterCode: string;
}

interface ActivePatch extends ContractRef {
  patchId: string;
  adapterCode: string;
  canaryPercent: number;
}

const LIVE_STATUSES: PatchStatus[] = ['CANARY', 'ACTIVE'];

/**
 * Owns the runtime side of a patch's lifecycle: canary deployment, traffic routing,
 * promotion and rollback. Postgres is the source of truth; this instance keeps an
 * in-memory copy of live patches so request routing never waits on I/O.
 */
@Injectable()
export class CanaryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CanaryService.name);
  private readonly activePatches = new Map<string, ActivePatch>();

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
    @Inject(CanaryMetricsService)
    private readonly metrics: CanaryMetricsService,
    @Inject(GatewayEventsService) private readonly events: GatewayEventsService,
  ) {}

  // Runs after every onModuleInit, so the database health check has already passed.
  async onApplicationBootstrap(): Promise<void> {
    const live = await this.db
      .select({
        patchId: patchRegistries.id,
        adapterCode: patchRegistries.adapterCode,
        canaryPercent: patchRegistries.canaryPercent,
        serviceName: serviceRegistries.serviceName,
        httpMethod: apiContracts.httpMethod,
        endpointPath: apiContracts.endpointPath,
      })
      .from(patchRegistries)
      .innerJoin(apiContracts, eq(patchRegistries.contractId, apiContracts.id))
      .innerJoin(
        serviceRegistries,
        eq(apiContracts.serviceId, serviceRegistries.id),
      )
      .where(inArray(patchRegistries.status, LIVE_STATUSES));
    for (const patch of live) this.activate(patch);
    if (live.length)
      this.logger.log(
        `Restored ${live.length} live patch(es) from the database.`,
      );
  }

  async deployPatch(patch: DeployablePatch): Promise<void> {
    const { canaryPercent } = this.config;
    await this.db.transaction(async (tx) => {
      await tx
        .update(patchRegistries)
        .set({ status: 'SUPERSEDED' })
        .where(
          and(
            eq(patchRegistries.contractId, patch.contractId),
            inArray(patchRegistries.status, LIVE_STATUSES),
            ne(patchRegistries.id, patch.patchId),
          ),
        );
      await tx
        .update(patchRegistries)
        .set({ status: 'CANARY', canaryPercent })
        .where(eq(patchRegistries.id, patch.patchId));
    });
    this.activate({
      ...patch.contract,
      patchId: patch.patchId,
      adapterCode: patch.adapterCode,
      canaryPercent,
    });
    this.logger.log(
      `Canary patch ${patch.patchId} deployed to ${contractKey(patch.contract)} (${canaryPercent}%).`,
    );
    this.events.publish({
      type: 'patch.deployed',
      patchId: patch.patchId,
      contract: patch.contract,
      canaryPercent,
    });
  }

  /**
   * Applies the contract's live patch when the request falls in its traffic share.
   * `canary` forces the routing decision; leave it undefined to sample by percentage.
   */
  applyPatch(
    contract: ContractRef,
    rawPayload: unknown,
    canary?: boolean,
  ): { payload: unknown; isPatched: boolean } {
    const patch = this.activePatches.get(contractKey(contract));
    if (!patch) return { payload: rawPayload, isPatched: false };

    const inCanary = canary ?? Math.random() * 100 < patch.canaryPercent;
    if (patch.canaryPercent < 100 && !inCanary) {
      this.metrics.record(patch.patchId, 'baseline');
      return { payload: rawPayload, isPatched: false };
    }

    const result = executeInSandbox(patch.adapterCode, rawPayload);
    if (result.success && result.transformedOutput !== undefined) {
      this.metrics.record(patch.patchId, 'patched');
      return { payload: result.transformedOutput, isPatched: true };
    }
    this.metrics.record(patch.patchId, 'adapterFailure');
    this.logger.warn(
      `Patch ${patch.patchId} failed at runtime: ${result.error}`,
    );
    return { payload: rawPayload, isPatched: false };
  }

  /** Browser-side copy of a service's live adapters, keyed by "METHOD /path". */
  getModuleFederationScript(serviceName: string): string {
    const adapters = [...this.activePatches.values()]
      .filter((patch) => patch.serviceName === serviceName)
      .map(
        (patch) =>
          `${JSON.stringify(`${patch.httpMethod} ${patch.endpointPath}`)}: ${patch.adapterCode}`,
      );
    const name = JSON.stringify(serviceName);

    return `
      (function(global) {
        global.__MFE_ORCHESTRATOR_PATCHES__ = global.__MFE_ORCHESTRATOR_PATCHES__ || {};
        global.__MFE_ORCHESTRATOR_PATCHES__[${name}] = { ${adapters.join(', ')} };
        console.log("[MFE Orchestrator] Module Federation runtime patches active for " + ${name});
      })(typeof window !== "undefined" ? window : globalThis);
    `.trim();
  }

  async promotePatch(
    patchId: string,
    serviceName: string,
  ): Promise<PatchRegistry> {
    const { patch, contract } = await this.findPatch(patchId, serviceName);
    if (patch.status !== 'CANARY')
      throw new ConflictException(
        `Only CANARY patches can be promoted (is ${patch.status})`,
      );

    const [promoted] = await this.db.transaction(async (tx) => {
      await tx
        .update(serviceRegistries)
        .set({ status: 'HEALTHY', updatedAt: new Date() })
        .where(eq(serviceRegistries.serviceName, serviceName));
      return tx
        .update(patchRegistries)
        .set({ status: 'ACTIVE', canaryPercent: 100, deployedAt: new Date() })
        .where(eq(patchRegistries.id, patchId))
        .returning();
    });
    this.activate({
      ...contract,
      patchId,
      adapterCode: patch.adapterCode,
      canaryPercent: 100,
    });
    this.logger.log(
      `Patch ${patchId} promoted to 100% for ${contractKey(contract)}.`,
    );
    this.events.publish({
      type: 'patch.promoted',
      patchId,
      contract,
      canaryPercent: 100,
    });
    return promoted;
  }

  async rollbackPatch(
    patchId: string,
    serviceName: string,
  ): Promise<PatchRegistry> {
    const { patch, contract } = await this.findPatch(patchId, serviceName);
    if (!LIVE_STATUSES.includes(patch.status))
      throw new ConflictException(
        `Only live patches can be rolled back (is ${patch.status})`,
      );

    const [rolledBack] = await this.db.transaction(async (tx) => {
      await tx
        .update(serviceRegistries)
        .set({ status: 'DRIFTING', updatedAt: new Date() })
        .where(eq(serviceRegistries.serviceName, serviceName));
      return tx
        .update(patchRegistries)
        .set({
          status: 'ROLLED_BACK',
          canaryPercent: 0,
          rolledBackAt: new Date(),
        })
        .where(eq(patchRegistries.id, patchId))
        .returning();
    });
    const key = contractKey(contract);
    if (this.activePatches.get(key)?.patchId === patchId)
      this.activePatches.delete(key);
    this.logger.log(`Patch ${patchId} rolled back for ${key}.`);
    this.events.publish({
      type: 'patch.rolledBack',
      patchId,
      contract,
      canaryPercent: 0,
    });
    return rolledBack;
  }

  private async findPatch(patchId: string, serviceName: string) {
    const [record] = await this.db
      .select({
        patch: patchRegistries,
        endpointPath: apiContracts.endpointPath,
        httpMethod: apiContracts.httpMethod,
      })
      .from(patchRegistries)
      .innerJoin(apiContracts, eq(patchRegistries.contractId, apiContracts.id))
      .innerJoin(
        serviceRegistries,
        eq(apiContracts.serviceId, serviceRegistries.id),
      )
      .where(
        and(
          eq(patchRegistries.id, patchId),
          eq(serviceRegistries.serviceName, serviceName),
        ),
      )
      .limit(1);
    if (!record)
      throw new NotFoundException('Patch not found for this service');
    const contract: ContractRef = {
      serviceName,
      httpMethod: record.httpMethod,
      endpointPath: record.endpointPath,
    };
    return { patch: record.patch, contract };
  }

  private activate(patch: ActivePatch): void {
    this.activePatches.set(contractKey(patch), {
      ...patch,
      httpMethod: patch.httpMethod.toUpperCase(),
      endpointPath: normalizeEndpointPath(patch.endpointPath),
    });
  }
}
