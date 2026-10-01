import { getServiceEndpoints } from '@orchestrator/config';
import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  flattenPayload,
  computeDriftCoefficient,
  analyzeSchemaDiff,
  type FlattenedSchema,
} from '@orchestrator/core';
import type { DriftType, Severity } from '@orchestrator/shared-types';
import {
  type DrizzleDb,
  serviceRegistries,
  apiContracts,
  driftEvents,
} from '@orchestrator/database';
import { eq, and, desc } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { DRIZZLE_DB, REDIS_CLIENT } from '../database/database.module.js';
import { CognitiveService } from '../cognitive/cognitive.service.js';
import { CanaryService } from '../canary/canary.service.js';

export interface ObservationContext {
  serviceName: string;
  endpointPath: string;
  httpMethod: string;
  observedPayload: unknown;
}

@Injectable()
export class ObservationService {
  private readonly logger = new Logger(ObservationService.name);

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly cognitiveService: CognitiveService,
    private readonly canaryService: CanaryService
  ) {}

  normalizePath(path: string): string {
    return path.replace(/\/\d+/g, '/:id');
  }

  async observe(ctx: ObservationContext): Promise<void> {
    const normalizedPath = this.normalizePath(ctx.endpointPath);
    const cacheKey = `contract:${ctx.serviceName}:${ctx.httpMethod}:${normalizedPath}`;

    const cachedSchemaRaw = await this.redis.get(cacheKey);
    let expectedSchemaTokens: FlattenedSchema;

    if (!cachedSchemaRaw) {
      // Fetch baseline from Supabase via Drizzle
      const [service] = await this.db
        .select()
        .from(serviceRegistries)
        .where(eq(serviceRegistries.serviceName, ctx.serviceName));

      let contract = null;
      if (service) {
        const [foundContract] = await this.db
          .select()
          .from(apiContracts)
          .where(
            and(
              eq(apiContracts.serviceId, service.id),
              eq(apiContracts.endpointPath, normalizedPath),
              eq(apiContracts.httpMethod, ctx.httpMethod),
              eq(apiContracts.isActive, true)
            )
          ).orderBy(desc(apiContracts.version)).limit(1);
        contract = foundContract;
      }

      if (!contract) {
        // Initial baseline bootstrap
        const initialTokens = flattenPayload(ctx.observedPayload);
        let serviceId = service?.id;

        if (!serviceId) {
          const [newService] = await this.db
            .insert(serviceRegistries)
            .values({
              serviceName: ctx.serviceName,
              serviceType: 'REST',
              endpointUrl: getServiceEndpoints()[ctx.serviceName],
              mfeConsumer: 'mfe-shell',
              status: 'HEALTHY',
            })
            .returning();
          serviceId = newService.id;
        }

        await this.db.insert(apiContracts).values({
          serviceId,
          endpointPath: normalizedPath,
          httpMethod: ctx.httpMethod,
          schemaSnapshot: Array.from(initialTokens),
          fieldCount: initialTokens.size,
          version: 1,
        });

        await this.redis.set(cacheKey, JSON.stringify(Array.from(initialTokens)), 'EX', 86400);
        return;
      }

      expectedSchemaTokens = new Set<string>(contract.schemaSnapshot as string[]);
      await this.redis.set(cacheKey, JSON.stringify(Array.from(expectedSchemaTokens)), 'EX', 86400);
    } else {
      expectedSchemaTokens = new Set<string>(JSON.parse(cachedSchemaRaw));
    }

    const observedTokens = flattenPayload(ctx.observedPayload);
    const driftCoeff = computeDriftCoefficient(expectedSchemaTokens, observedTokens);
    const DRIFT_THRESHOLD = Number(process.env.DRIFT_SIMILARITY_THRESHOLD) || 0.15;

    if (driftCoeff > DRIFT_THRESHOLD) {
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

      this.logger.warn(`API Drift Detected: ${ctx.serviceName} ${normalizedPath} (Dc=${driftCoeff.toFixed(2)})`);

      const [service] = await this.db
        .select()
        .from(serviceRegistries)
        .where(eq(serviceRegistries.serviceName, ctx.serviceName));

      if (!service) return;

      const [contract] = await this.db
        .select()
        .from(apiContracts)
        .where(
          and(
            eq(apiContracts.serviceId, service.id),
            eq(apiContracts.endpointPath, normalizedPath),
            eq(apiContracts.httpMethod, ctx.httpMethod),
            eq(apiContracts.isActive, true)
          )
        ).orderBy(desc(apiContracts.version)).limit(1);

      if (!contract) return;

      const [driftEvent] = await this.db
        .insert(driftEvents)
        .values({
          contractId: contract.id,
          serviceId: service.id,
          driftType,
          severity,
          driftCoefficient: Number(driftCoeff.toFixed(4)),
          observedPayload: ctx.observedPayload as object,
          diffDetails: diff as unknown as object,
          isBreaking,
        })
        .returning();

      await this.db
        .update(serviceRegistries)
        .set({ status: 'DRIFTING' })
        .where(eq(serviceRegistries.id, service.id));

      if (isBreaking) {
        setImmediate(async () => {
          const adapterCode = await this.cognitiveService.generateAndValidatePatch(this.db, {
            driftEventId: driftEvent.id,
            contractId: contract.id,
            serviceName: ctx.serviceName,
            endpointPath: normalizedPath,
            expectedSchema: Array.from(expectedSchemaTokens),
            diffDetails: diff,
            samplePayload: ctx.observedPayload,
          });

          if (adapterCode) {
            await this.canaryService.deployPatch(ctx.serviceName, driftEvent.id, adapterCode);
          }
        });
      }
    }
  }
}
