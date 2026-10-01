import {
  flattenPayload,
  computeDriftCoefficient,
  analyzeSchemaDiff,
  type FlattenedSchema,
} from '@orchestrator/core';
import type { DriftType, Severity } from '@orchestrator/shared-types';
import { prisma, redis } from '../db.js';
import { triggerPatchGeneration } from './reasoning.js';

export interface InterceptContext {
  serviceId: string;
  serviceName: string;
  endpointPath: string;
  httpMethod: string;
  observedPayload: unknown;
}

/**
 * Normalizes endpoint path by replacing IDs with parameter placeholders
 * e.g., /api/v1/users/101 -> /api/v1/users/:id
 */
export function normalizeEndpointPath(path: string): string {
  return path.replace(/\/\d+/g, '/:id');
}

/**
 * Intercepts outbound responses, computes Jaccard drift against cached/stored contract,
 * and asynchronously routes drift events to the cognitive agent.
 */
export async function observeAndEvaluateDrift(ctx: InterceptContext): Promise<void> {
  const normalizedPath = normalizeEndpointPath(ctx.endpointPath);
  const cacheKey = `contract:${ctx.serviceName}:${ctx.httpMethod}:${normalizedPath}`;

  // 1. Check Redis for established contract schema
  let cachedSchemaRaw = await redis.get(cacheKey);
  let expectedSchemaTokens: FlattenedSchema;

  if (!cachedSchemaRaw) {
    // 2. Fetch contract from PostgreSQL
    const contract = await prisma.apiContract.findFirst({
      where: {
        service: { serviceName: ctx.serviceName },
        endpointPath: normalizedPath,
        httpMethod: ctx.httpMethod,
        isActive: true,
      },
    });

    if (!contract) {
      // First observation: initialize contract baseline
      const initialTokens = flattenPayload(ctx.observedPayload);
      const service = await prisma.serviceRegistry.upsert({
        where: { serviceName: ctx.serviceName },
        update: { lastCheckedAt: new Date() },
        create: {
          serviceName: ctx.serviceName,
          serviceType: 'REST',
          endpointUrl: `http://localhost:${ctx.serviceName === 'user-service' ? '3001' : '3002'}`,
          mfeConsumer: 'mfe-shell',
          status: 'HEALTHY',
        },
      });

      await prisma.apiContract.create({
        data: {
          serviceId: service.id,
          endpointPath: normalizedPath,
          httpMethod: ctx.httpMethod,
          schemaSnapshot: Array.from(initialTokens),
          fieldCount: initialTokens.size,
          version: 1,
        },
      });

      await redis.set(cacheKey, JSON.stringify(Array.from(initialTokens)), 'EX', 86400);
      return;
    }

    expectedSchemaTokens = new Set<string>(contract.schemaSnapshot as string[]);
    await redis.set(cacheKey, JSON.stringify(Array.from(expectedSchemaTokens)), 'EX', 86400);
  } else {
    expectedSchemaTokens = new Set<string>(JSON.parse(cachedSchemaRaw));
  }

  // 3. Flatten observed live payload
  const observedTokens = flattenPayload(ctx.observedPayload);

  // 4. Compute Drift Coefficient: Dc = 1 - J(Se, So)
  const driftCoeff = computeDriftCoefficient(expectedSchemaTokens, observedTokens);
  const DRIFT_THRESHOLD = Number(process.env.DRIFT_SIMILARITY_THRESHOLD) || 0.15;

  if (driftCoeff > DRIFT_THRESHOLD) {
    // Schema drift detected!
    const diff = analyzeSchemaDiff(expectedSchemaTokens, observedTokens);

    let driftType: DriftType = 'FIELD_RENAMED';
    if (diff.missingFields.length > 0 && diff.addedFields.length > 0) {
      driftType = 'FIELD_RENAMED';
    } else if (diff.missingFields.length > 0) {
      driftType = 'FIELD_DELETED';
    } else if (diff.typeMismatches.length > 0) {
      driftType = 'TYPE_CHANGED';
    } else if (diff.addedFields.length > 0) {
      driftType = 'FIELD_ADDED';
    }

    const isBreaking = diff.missingFields.length > 0 || diff.typeMismatches.length > 0;
    const severity: Severity = isBreaking ? (driftCoeff > 0.4 ? 'CRITICAL' : 'HIGH') : 'LOW';

    const service = await prisma.serviceRegistry.findUnique({
      where: { serviceName: ctx.serviceName },
    });
    const contract = await prisma.apiContract.findFirst({
      where: {
        serviceId: service?.id,
        endpointPath: normalizedPath,
        httpMethod: ctx.httpMethod,
      },
    });

    if (service && contract) {
      // Record drift event in PostgreSQL
      const driftEvent = await prisma.driftEvent.create({
        data: {
          contractId: contract.id,
          serviceId: service.id,
          driftType,
          severity,
          driftCoefficient: Number(driftCoeff.toFixed(4)),
          observedPayload: ctx.observedPayload as object,
          diffDetails: diff as unknown as object,
          isBreaking,
        },
      });

      // Update service status
      await prisma.serviceRegistry.update({
        where: { id: service.id },
        data: { status: 'DRIFTING' },
      });

      console.warn(`[ObservationEngine] Drift Detected: ${ctx.serviceName} ${normalizedPath} (Dc=${driftCoeff.toFixed(2)})`);

      // Trigger Cognitive Reasoning Engine asynchronously
      if (isBreaking) {
        setImmediate(() => {
          triggerPatchGeneration({
            driftEventId: driftEvent.id,
            contractId: contract.id,
            serviceName: ctx.serviceName,
            endpointPath: normalizedPath,
            expectedSchema: Array.from(expectedSchemaTokens),
            diffDetails: diff,
            samplePayload: ctx.observedPayload,
          }).catch((err) => console.error('[CognitiveEngine] Async Error:', err));
        });
      }
    }
  }
}
