import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  apiContracts,
  consumers,
  governanceAudits,
  patchRegistries,
  promotionPolicies,
  serviceRegistries,
  type DrizzleDb,
  type PromotionPolicy,
} from '@orchestrator/database';
import type { PatchGenerator, PolicyOutlook, PromotionPolicyView } from '@orchestrator/shared-types';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { OrgAccess } from '../auth/org.guard.js';
import type { AuthenticatedUser } from '../auth/token-verifier.js';
import { CanaryMetricsService } from '../canary/canary-metrics.service.js';
import { generatorOf } from '../cognitive/patch-generation.js';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import { ActivityService } from '../orgs/activity.service.js';
import { decide, matchPolicy, scopeKey } from './policy-decision.js';
import type { CreatePolicyDto, UpdatePolicyDto } from './policies.dto.js';

const ENGINE_REVIEWER = 'CognitiveReasoningEngine';

export interface CanaryPatch {
  patchId: string;
  orgId: string;
  serviceId: string;
  serviceName: string;
  consumerId: string;
  consumerName: string;
  httpMethod: string;
  endpointPath: string;
  deployedAt: Date | null;
  generator: PatchGenerator;
}

/** Promotion policies and what they will do to each canary patch. */
@Injectable()
export class PoliciesService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    @Inject(CanaryMetricsService) private readonly metrics: CanaryMetricsService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  async list(orgId: string): Promise<PromotionPolicyView[]> {
    const rows = await this.db
      .select({ policy: promotionPolicies, serviceName: serviceRegistries.serviceName, consumerName: consumers.name })
      .from(promotionPolicies)
      .leftJoin(serviceRegistries, eq(promotionPolicies.serviceId, serviceRegistries.id))
      .leftJoin(consumers, eq(promotionPolicies.consumerId, consumers.id))
      .where(eq(promotionPolicies.orgId, orgId))
      .orderBy(asc(promotionPolicies.createdAt));
    return rows.map(({ policy, serviceName, consumerName }) => toView(policy, serviceName, consumerName));
  }

  async create(org: OrgAccess, dto: CreatePolicyDto, user: AuthenticatedUser): Promise<PromotionPolicyView> {
    await this.checkScope(org.id, dto.serviceId, dto.consumerId);
    const scope = scopeKey(dto.serviceId ?? null, dto.consumerId ?? null);
    const [existing] = await this.db
      .select({ id: promotionPolicies.id })
      .from(promotionPolicies)
      .where(and(eq(promotionPolicies.orgId, org.id), eq(promotionPolicies.scope, scope)));
    if (existing) throw new ConflictException('A policy already covers this service and consumer; edit it instead');
    const [created] = await this.db
      .insert(promotionPolicies)
      .values({
        orgId: org.id,
        serviceId: dto.serviceId ?? null,
        consumerId: dto.consumerId ?? null,
        scope,
        ...rulesFrom(dto),
        name: dto.name,
      })
      .returning();
    await this.activity.record(org.id, {
      actor: user.email ?? user.id,
      action: 'policy.created',
      targetType: 'policy',
      targetId: created!.id,
      details: { name: dto.name },
    });
    return this.view(org.id, created!.id);
  }

  async update(org: OrgAccess, id: string, dto: UpdatePolicyDto, user: AuthenticatedUser): Promise<PromotionPolicyView> {
    await this.policy(org.id, id);
    await this.db
      .update(promotionPolicies)
      .set({ ...rulesFrom(dto), updatedAt: new Date() })
      .where(and(eq(promotionPolicies.id, id), eq(promotionPolicies.orgId, org.id)));
    await this.activity.record(org.id, {
      actor: user.email ?? user.id,
      action: 'policy.updated',
      targetType: 'policy',
      targetId: id,
      details: { ...dto },
    });
    return this.view(org.id, id);
  }

  async remove(org: OrgAccess, id: string, user: AuthenticatedUser): Promise<void> {
    const policy = await this.policy(org.id, id);
    await this.db.delete(promotionPolicies).where(eq(promotionPolicies.id, id));
    await this.activity.record(org.id, {
      actor: user.email ?? user.id,
      action: 'policy.deleted',
      targetType: 'policy',
      targetId: id,
      details: { name: policy.name },
    });
  }

  /** Every canary patch with the policy that governs it and what that policy will do now. */
  async outlook(orgId: string): Promise<PolicyOutlook[]> {
    const [patches, policies] = await Promise.all([this.canaryPatches(orgId), this.enabledPolicies([orgId])]);
    return Promise.all(
      patches.map(async (patch) => {
        const policy = matchPolicy(policies, patch.serviceId, patch.consumerId);
        const decision = policy
          ? decide(policy, await this.metrics.traffic(patch.patchId), patch.deployedAt, patch.generator)
          : null;
        return {
          patchId: patch.patchId,
          contract: {
            serviceName: patch.serviceName,
            httpMethod: patch.httpMethod,
            endpointPath: patch.endpointPath,
            consumerId: patch.consumerId,
            consumerName: patch.consumerName,
          },
          generator: patch.generator,
          deployedAt: patch.deployedAt?.toISOString() ?? null,
          policy: policy && {
            id: policy.id,
            name: policy.name,
            minCanaryRequests: policy.minCanaryRequests,
            minCanaryMinutes: policy.minCanaryMinutes,
            maxFailureRate: policy.maxFailureRate,
            rollbackFailureRate: policy.rollbackFailureRate,
          },
          decision,
        };
      }),
    );
  }

  /** CANARY patches, optionally across all organizations (for the evaluator). */
  async canaryPatches(orgId?: string): Promise<CanaryPatch[]> {
    const rows = await this.db
      .select({
        patchId: patchRegistries.id,
        orgId: patchRegistries.orgId,
        serviceId: serviceRegistries.id,
        serviceName: serviceRegistries.serviceName,
        consumerId: consumers.id,
        consumerName: consumers.name,
        httpMethod: apiContracts.httpMethod,
        endpointPath: apiContracts.endpointPath,
        deployedAt: patchRegistries.deployedAt,
      })
      .from(patchRegistries)
      .innerJoin(apiContracts, eq(patchRegistries.contractId, apiContracts.id))
      .innerJoin(serviceRegistries, eq(apiContracts.serviceId, serviceRegistries.id))
      .innerJoin(consumers, eq(patchRegistries.consumerId, consumers.id))
      .where(
        and(eq(patchRegistries.status, 'CANARY'), orgId ? eq(patchRegistries.orgId, orgId) : undefined),
      )
      .orderBy(asc(patchRegistries.deployedAt));
    if (!rows.length) return [];
    const traces = await this.db
      .select({ patchId: governanceAudits.patchId, trace: governanceAudits.reasoningTrace })
      .from(governanceAudits)
      .where(
        and(
          inArray(
            governanceAudits.patchId,
            rows.map((row) => row.patchId),
          ),
          eq(governanceAudits.reviewer, ENGINE_REVIEWER),
        ),
      );
    const generators = new Map(traces.map((t) => [t.patchId, generatorOf(t.trace)]));
    return rows.map((row) => ({ ...row, generator: generators.get(row.patchId) ?? 'unknown' }));
  }

  async enabledPolicies(orgIds: string[]): Promise<PromotionPolicy[]> {
    if (!orgIds.length) return [];
    return this.db
      .select()
      .from(promotionPolicies)
      .where(and(inArray(promotionPolicies.orgId, orgIds), eq(promotionPolicies.enabled, true)));
  }

  private async view(orgId: string, id: string): Promise<PromotionPolicyView> {
    const view = (await this.list(orgId)).find((policy) => policy.id === id);
    if (!view) throw new NotFoundException('Policy not found');
    return view;
  }

  private async policy(orgId: string, id: string): Promise<PromotionPolicy> {
    const [policy] = await this.db
      .select()
      .from(promotionPolicies)
      .where(and(eq(promotionPolicies.id, id), eq(promotionPolicies.orgId, orgId)));
    if (!policy) throw new NotFoundException('Policy not found');
    return policy;
  }

  /** The service and consumer must belong to this organization. */
  private async checkScope(orgId: string, serviceId?: string, consumerId?: string): Promise<void> {
    if (serviceId) {
      const [service] = await this.db
        .select({ id: serviceRegistries.id })
        .from(serviceRegistries)
        .where(and(eq(serviceRegistries.id, serviceId), eq(serviceRegistries.orgId, orgId)));
      if (!service) throw new BadRequestException('Unknown service');
    }
    if (consumerId) {
      const [consumer] = await this.db
        .select({ id: consumers.id })
        .from(consumers)
        .where(and(eq(consumers.id, consumerId), eq(consumers.orgId, orgId)));
      if (!consumer) throw new BadRequestException('Unknown consumer');
    }
  }
}

function rulesFrom(dto: UpdatePolicyDto) {
  const rules: Partial<typeof promotionPolicies.$inferInsert> = {};
  if (dto.name !== undefined) rules.name = dto.name;
  if (dto.enabled !== undefined) rules.enabled = dto.enabled;
  if (dto.minCanaryRequests !== undefined) rules.minCanaryRequests = dto.minCanaryRequests;
  if (dto.minCanaryMinutes !== undefined) rules.minCanaryMinutes = dto.minCanaryMinutes;
  if (dto.maxFailureRate !== undefined) rules.maxFailureRate = dto.maxFailureRate;
  if (dto.rollbackFailureRate !== undefined) rules.rollbackFailureRate = dto.rollbackFailureRate;
  if (dto.rollbackMinRequests !== undefined) rules.rollbackMinRequests = dto.rollbackMinRequests;
  if (dto.allowedGenerators !== undefined) rules.allowedGenerators = [...new Set(dto.allowedGenerators)];
  return rules;
}

function toView(policy: PromotionPolicy, serviceName: string | null, consumerName: string | null): PromotionPolicyView {
  return {
    id: policy.id,
    name: policy.name,
    enabled: policy.enabled,
    serviceId: policy.serviceId,
    serviceName,
    consumerId: policy.consumerId,
    consumerName,
    minCanaryRequests: policy.minCanaryRequests,
    minCanaryMinutes: policy.minCanaryMinutes,
    maxFailureRate: policy.maxFailureRate,
    rollbackFailureRate: policy.rollbackFailureRate,
    rollbackMinRequests: policy.rollbackMinRequests,
    allowedGenerators: policy.allowedGenerators as PatchGenerator[],
    createdAt: policy.createdAt.toISOString(),
    updatedAt: policy.updatedAt.toISOString(),
  };
}
