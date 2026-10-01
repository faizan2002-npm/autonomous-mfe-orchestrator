import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { executeInSandbox } from '@orchestrator/adapter-runtime';
import {
  type DrizzleDb,
  patchRegistries,
  apiContracts,
  serviceRegistries,
} from '@orchestrator/database';
import { and, eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import { REDIS_CLIENT } from '../redis/redis.tokens.js';

interface ActivePatch {
  patchId: string;
  serviceName: string;
  adapterCode: string;
  canaryPercent: number;
}

@Injectable()
export class CanaryService {
  private readonly logger = new Logger(CanaryService.name);
  private readonly localPatches = new Map<string, ActivePatch>();

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async deployPatch(
    serviceName: string,
    patchId: string,
    adapterCode: string,
  ): Promise<void> {
    const patch: ActivePatch = {
      patchId,
      serviceName,
      adapterCode,
      canaryPercent: 10,
    };

    this.localPatches.set(serviceName, patch);
    await this.redis.set(`active_patch:${serviceName}`, JSON.stringify(patch));
    this.logger.log(
      `Canary patch for '${serviceName}' deployed (10% allocation).`,
    );
  }

  applyPatchIfActive(
    serviceName: string,
    rawPayload: unknown,
    isCanary: boolean,
  ): { payload: unknown; isPatched: boolean } {
    const patch = this.localPatches.get(serviceName);
    if (!patch) return { payload: rawPayload, isPatched: false };

    const shouldApply = patch.canaryPercent >= 100 || isCanary;
    if (!shouldApply) return { payload: rawPayload, isPatched: false };

    const result = executeInSandbox(patch.adapterCode, rawPayload);
    if (result.success && result.transformedOutput !== undefined) {
      return { payload: result.transformedOutput, isPatched: true };
    }

    return { payload: rawPayload, isPatched: false };
  }

  getModuleFederationScript(serviceName: string): string {
    const patch = this.localPatches.get(serviceName);
    const code = patch?.adapterCode || '(data) => data';

    return `
      (function(global) {
        global.__MFE_ORCHESTRATOR_PATCHES__ = global.__MFE_ORCHESTRATOR_PATCHES__ || {};
        global.__MFE_ORCHESTRATOR_PATCHES__["${serviceName}"] = ${code};
        console.log("[MFE Orchestrator] Module Federation runtime patch active for ${serviceName}");
      })(typeof window !== "undefined" ? window : globalThis);
    `.trim();
  }

  async promotePatch(patchId: string, serviceName: string): Promise<void> {
    const [record] = await this.db
      .select({ patch: patchRegistries })
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

    await this.db
      .update(patchRegistries)
      .set({
        status: 'ACTIVE',
        canaryPercent: 100,
        deployedAt: new Date(),
      })
      .where(eq(patchRegistries.id, patchId));

    const promoted: ActivePatch = {
      patchId,
      serviceName,
      adapterCode: record.patch.adapterCode,
      canaryPercent: 100,
    };
    await this.redis.set(
      `active_patch:${serviceName}`,
      JSON.stringify(promoted),
    );
    this.localPatches.set(serviceName, promoted);

    this.logger.log(
      `Patch ${patchId} promoted to 100% PRODUCTION for service '${serviceName}'!`,
    );
  }
}
