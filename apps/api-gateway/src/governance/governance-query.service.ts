import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { executeInSandbox } from '@orchestrator/adapter-runtime';
import { assessDrift } from '@orchestrator/core';
import {
  apiContracts,
  driftEvents,
  governanceAudits,
  patchRegistries,
  serviceRegistries,
  type DrizzleDb,
  type GovernanceAudit,
} from '@orchestrator/database';
import {
  PATCH_STATUSES,
  SERVICE_STATUSES,
  type AuditView,
  type ContractView,
  type DashboardStats,
  type DriftEventDetail,
  type DriftEventView,
  type DriftType,
  type Page,
  type PatchDetail,
  type PatchPreview,
  type PatchStatus,
  type PatchView,
  type PublicConfig,
  type SchemaDiff,
  type ServiceDetail,
  type ServiceSummary,
} from '@orchestrator/shared-types';
import { and, desc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { CanaryMetricsService } from '../canary/canary-metrics.service.js';
import { generatorOf } from '../cognitive/patch-generation.js';
import {
  GATEWAY_CONFIG,
  type GatewayConfig,
} from '../config/gateway-config.js';
import { DRIZZLE_DB } from '../database/database.tokens.js';

const ENGINE_REVIEWER = 'CognitiveReasoningEngine';
const DAY_MS = 86_400_000;

export interface DriftEventFilter {
  service?: string;
  type?: DriftType;
  limit: number;
  cursor?: string;
}

export interface PatchFilter {
  status?: PatchStatus;
  service?: string;
}

/** Read models for the dashboard; all writes go through GovernanceService and CanaryService. */
@Injectable()
export class GovernanceQueryService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
    @Inject(CanaryMetricsService)
    private readonly metrics: CanaryMetricsService,
  ) {}

  async getStats(): Promise<DashboardStats> {
    const since = new Date(Date.now() - DAY_MS);
    const [services, patches, [drift]] = await Promise.all([
      this.db
        .select({
          status: serviceRegistries.status,
          count: sql<number>`count(*)::int`,
        })
        .from(serviceRegistries)
        .groupBy(serviceRegistries.status),
      this.db
        .select({
          status: patchRegistries.status,
          count: sql<number>`count(*)::int`,
        })
        .from(patchRegistries)
        .groupBy(patchRegistries.status),
      this.db
        .select({
          total: sql<number>`count(*)::int`,
          breaking: sql<number>`count(*) filter (where ${driftEvents.isBreaking})::int`,
        })
        .from(driftEvents)
        .where(gte(driftEvents.detectedAt, since)),
    ]);
    return {
      services: countBy(SERVICE_STATUSES, services),
      patches: countBy(PATCH_STATUSES, patches),
      driftEvents24h: drift?.total ?? 0,
      breakingDriftEvents24h: drift?.breaking ?? 0,
    };
  }

  async listServices(): Promise<ServiceSummary[]> {
    const [services, contracts, lastDrift] = await Promise.all([
      this.db
        .select()
        .from(serviceRegistries)
        .orderBy(serviceRegistries.serviceName),
      this.db
        .select({
          serviceId: apiContracts.serviceId,
          count: sql<number>`count(*)::int`,
        })
        .from(apiContracts)
        .groupBy(apiContracts.serviceId),
      this.db
        .select({
          serviceId: driftEvents.serviceId,
          at: sql<Date>`max(${driftEvents.detectedAt})`,
        })
        .from(driftEvents)
        .groupBy(driftEvents.serviceId),
    ]);
    const contractCounts = new Map(
      contracts.map((row) => [row.serviceId, row.count]),
    );
    const driftTimes = new Map(lastDrift.map((row) => [row.serviceId, row.at]));
    return services.map((service) => ({
      id: service.id,
      serviceName: service.serviceName,
      endpointUrl: service.endpointUrl,
      status: service.status,
      contractCount: contractCounts.get(service.id) ?? 0,
      lastDriftAt: iso(driftTimes.get(service.id) ?? null),
      updatedAt: service.updatedAt.toISOString(),
    }));
  }

  async getService(serviceName: string): Promise<ServiceDetail> {
    const summary = (await this.listServices()).find(
      (service) => service.serviceName === serviceName,
    );
    if (!summary)
      throw new NotFoundException(`Unknown service '${serviceName}'`);
    const [contracts, recentDrift] = await Promise.all([
      this.db
        .select()
        .from(apiContracts)
        .where(eq(apiContracts.serviceId, summary.id))
        .orderBy(apiContracts.endpointPath, desc(apiContracts.version)),
      this.listDriftEvents({ service: serviceName, limit: 20 }),
    ]);
    return {
      ...summary,
      contracts: contracts.map((contract): ContractView => ({
        id: contract.id,
        serviceName,
        httpMethod: contract.httpMethod,
        endpointPath: contract.endpointPath,
        version: contract.version,
        fieldCount: contract.fieldCount,
        schemaTokens: contract.schemaSnapshot as string[],
        createdAt: contract.createdAt.toISOString(),
      })),
      recentDrift: recentDrift.items,
    };
  }

  async listDriftEvents(
    filter: DriftEventFilter,
  ): Promise<Page<DriftEventView>> {
    const conditions: SQL[] = [];
    if (filter.service)
      conditions.push(eq(serviceRegistries.serviceName, filter.service));
    if (filter.type) conditions.push(eq(driftEvents.driftType, filter.type));
    if (filter.cursor)
      conditions.push(lt(driftEvents.detectedAt, new Date(filter.cursor)));
    const rows = await this.driftQuery()
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(driftEvents.detectedAt))
      .limit(filter.limit + 1);
    const items = await this.toDriftViews(rows.slice(0, filter.limit));
    const last = items[items.length - 1];
    return {
      items,
      nextCursor: rows.length > filter.limit && last ? last.detectedAt : null,
    };
  }

  async getDriftEvent(id: string): Promise<DriftEventDetail> {
    const [row] = await this.driftQuery()
      .where(eq(driftEvents.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Drift event not found');
    const [view] = await this.toDriftViews([row]);
    return {
      ...view,
      expectedSchema: row.schemaSnapshot as string[],
      diff: row.event.diffDetails as SchemaDiff,
      observedPayload: row.event.observedPayload,
    };
  }

  async listPatches(filter: PatchFilter): Promise<PatchView[]> {
    const conditions: SQL[] = [];
    if (filter.status)
      conditions.push(eq(patchRegistries.status, filter.status));
    if (filter.service)
      conditions.push(eq(serviceRegistries.serviceName, filter.service));
    const rows = await this.patchQuery()
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(patchRegistries.createdAt))
      .limit(100);
    const audits = await this.auditsFor(rows.map((row) => row.patch.id));
    return rows.map((row) => toPatchView(row, audits));
  }

  async getPatch(id: string): Promise<PatchDetail> {
    const [row] = await this.patchQuery()
      .where(eq(patchRegistries.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Patch not found');
    const [audits, driftEvent, traffic] = await Promise.all([
      this.auditsFor([id]),
      this.getDriftEvent(row.patch.driftEventId),
      this.metrics.traffic(id),
    ]);
    return {
      ...toPatchView(row, audits),
      adapterCode: row.patch.adapterCode,
      driftEvent,
      traffic,
      audits: audits.filter((audit) => audit.patchId === id).map(toAuditView),
    };
  }

  /** Runs the adapter on its source drift payload without touching live traffic. */
  async previewPatch(id: string): Promise<PatchPreview> {
    const patch = await this.getPatch(id);
    const input = patch.driftEvent.observedPayload;
    const result = executeInSandbox(patch.adapterCode, input);
    const residual = result.success
      ? assessDrift(
          patch.driftEvent.expectedSchema,
          result.transformedOutput,
          0,
        )
      : null;
    return {
      input,
      output: result.transformedOutput ?? null,
      success: result.success,
      error: result.error ?? null,
      executionTimeMs: result.executionTimeMs,
      stillBreaking: !result.success || Boolean(residual?.isBreaking),
      residualDiff: residual?.diff ?? null,
    };
  }

  async listAudits(limit: number): Promise<AuditView[]> {
    const rows = await this.db
      .select()
      .from(governanceAudits)
      .orderBy(desc(governanceAudits.createdAt))
      .limit(limit);
    return rows.map(toAuditView);
  }

  getPublicConfig(): PublicConfig {
    return {
      driftThreshold: this.config.driftThreshold,
      canaryPercent: this.config.canaryPercent,
      geminiModel: this.config.gemini.model,
      geminiConfigured: Boolean(this.config.gemini.apiKey),
      services: Object.keys(this.config.serviceEndpoints),
    };
  }

  private driftQuery() {
    return this.db
      .select({
        event: driftEvents,
        serviceName: serviceRegistries.serviceName,
        httpMethod: apiContracts.httpMethod,
        endpointPath: apiContracts.endpointPath,
        schemaSnapshot: apiContracts.schemaSnapshot,
      })
      .from(driftEvents)
      .innerJoin(apiContracts, eq(driftEvents.contractId, apiContracts.id))
      .innerJoin(
        serviceRegistries,
        eq(driftEvents.serviceId, serviceRegistries.id),
      )
      .$dynamic();
  }

  private patchQuery() {
    return this.db
      .select({
        patch: patchRegistries,
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
      .$dynamic();
  }

  private async toDriftViews(
    rows: Awaited<ReturnType<GovernanceQueryService['driftQuery']>>,
  ): Promise<DriftEventView[]> {
    const ids = rows.map((row) => row.event.id);
    const patches = ids.length
      ? await this.db
          .select({
            id: patchRegistries.id,
            driftEventId: patchRegistries.driftEventId,
            status: patchRegistries.status,
          })
          .from(patchRegistries)
          .where(inArray(patchRegistries.driftEventId, ids))
          .orderBy(desc(patchRegistries.createdAt))
      : [];
    return rows.map((row) => {
      const patch = patches.find(
        (candidate) => candidate.driftEventId === row.event.id,
      );
      return {
        id: row.event.id,
        contractId: row.event.contractId,
        contract: {
          serviceName: row.serviceName,
          httpMethod: row.httpMethod,
          endpointPath: row.endpointPath,
        },
        driftType: row.event.driftType,
        severity: row.event.severity,
        driftCoefficient: row.event.driftCoefficient,
        isBreaking: row.event.isBreaking,
        detectedAt: row.event.detectedAt.toISOString(),
        patchId: patch?.id ?? null,
        patchStatus: patch?.status ?? null,
      };
    });
  }

  private auditsFor(patchIds: string[]): Promise<GovernanceAudit[]> {
    if (!patchIds.length) return Promise.resolve([]);
    return this.db
      .select()
      .from(governanceAudits)
      .where(inArray(governanceAudits.patchId, patchIds))
      .orderBy(governanceAudits.createdAt);
  }
}

type PatchRow = Awaited<
  ReturnType<GovernanceQueryService['patchQuery']>
>[number];

function toPatchView(row: PatchRow, audits: GovernanceAudit[]): PatchView {
  const engineAudit = audits.find(
    (audit) =>
      audit.patchId === row.patch.id && audit.reviewer === ENGINE_REVIEWER,
  );
  return {
    id: row.patch.id,
    contract: {
      serviceName: row.serviceName,
      httpMethod: row.httpMethod,
      endpointPath: row.endpointPath,
    },
    driftEventId: row.patch.driftEventId,
    status: row.patch.status,
    canaryPercent: row.patch.canaryPercent,
    confidenceScore: row.patch.confidenceScore,
    generator: generatorOf(engineAudit?.reasoningTrace),
    createdAt: row.patch.createdAt.toISOString(),
    deployedAt: iso(row.patch.deployedAt),
    rolledBackAt: iso(row.patch.rolledBackAt),
  };
}

function toAuditView(audit: GovernanceAudit): AuditView {
  return {
    id: audit.id,
    driftEventId: audit.driftEventId,
    patchId: audit.patchId,
    status: audit.status,
    reviewer: audit.reviewer,
    reviewNotes: audit.reviewNotes,
    reasoningTrace: audit.reasoningTrace,
    reviewedAt: iso(audit.reviewedAt),
    createdAt: audit.createdAt.toISOString(),
  };
}

function countBy<T extends string>(
  keys: readonly T[],
  rows: Array<{ status: T; count: number }>,
): Record<T, number> {
  const counts = Object.fromEntries(keys.map((key) => [key, 0])) as Record<
    T,
    number
  >;
  for (const row of rows) counts[row.status] = row.count;
  return counts;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}
