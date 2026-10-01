import { prisma, redis } from '../db.js';
import { executeInSandbox } from '@orchestrator/core';

interface ActivePatch {
  patchId: string;
  serviceName: string;
  adapterCode: string;
  canaryPercent: number;
}

const localPatchMemory = new Map<string, ActivePatch>();

/**
 * Registers newly validated patch and exposes it to live gateway traffic
 */
export async function registerAndDeployPatch(
  patchId: string,
  serviceName: string,
  adapterCode: string
): Promise<void> {
  const activePatch: ActivePatch = {
    patchId,
    serviceName,
    adapterCode,
    canaryPercent: 10,
  };

  localPatchMemory.set(serviceName, activePatch);
  await redis.set(`active_patch:${serviceName}`, JSON.stringify(activePatch));

  console.log(`[ExecutionEngine] Canary patch deployed for ${serviceName} (10% traffic allocation).`);
}

/**
 * Intercepts payload and applies active adapter if canary conditions match
 */
export function applyPatchIfActive(
  serviceName: string,
  rawPayload: unknown,
  isCanaryCandidate: boolean
): { payload: unknown; isPatched: boolean } {
  const patch = localPatchMemory.get(serviceName);
  if (!patch) return { payload: rawPayload, isPatched: false };

  // Rollout decision
  const shouldApply = patch.canaryPercent >= 100 || isCanaryCandidate;
  if (!shouldApply) return { payload: rawPayload, isPatched: false };

  const result = executeInSandbox(patch.adapterCode, rawPayload);
  if (result.success && result.transformedOutput) {
    return { payload: result.transformedOutput, isPatched: true };
  }

  return { payload: rawPayload, isPatched: false };
}

/**
 * Exposes Webpack 5 Module Federation Virtual Container script for remote micro-frontend injection
 */
export function generateModuleFederationEntry(serviceName: string): string {
  const patch = localPatchMemory.get(serviceName);
  const code = patch?.adapterCode || '(data) => data';

  return `
    (function(global) {
      global.__MFE_ORCHESTRATOR_PATCHES__ = global.__MFE_ORCHESTRATOR_PATCHES__ || {};
      global.__MFE_ORCHESTRATOR_PATCHES__["${serviceName}"] = ${code};
      console.log("[MFE Orchestrator] Injected runtime patch for ${serviceName}");
    })(typeof window !== "undefined" ? window : globalThis);
  `.trim();
}

/**
 * Promotes canary patch to 100% full production rollout
 */
export async function promotePatch(patchId: string, serviceName: string): Promise<void> {
  const patch = localPatchMemory.get(serviceName);
  if (patch && patch.patchId === patchId) {
    patch.canaryPercent = 100;
    localPatchMemory.set(serviceName, patch);
    await redis.set(`active_patch:${serviceName}`, JSON.stringify(patch));

    await prisma.patchRegistry.update({
      where: { id: patchId },
      data: {
        status: 'ACTIVE',
        canaryPercent: 100,
        deployedAt: new Date(),
      },
    });

    console.log(`[CanaryEngine] Patch ${patchId} for ${serviceName} promoted to 100% PRODUCTION!`);
  }
}
