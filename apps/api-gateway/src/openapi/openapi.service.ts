import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { findOperation, OpenApiError, parseOpenApi } from '@orchestrator/core';
import {
  apiContracts,
  consumers,
  serviceOperations,
  serviceRegistries,
  type DrizzleDb,
  type OpenApiImportInfo,
  type ServiceOperation,
} from '@orchestrator/database';
import type { ContractComparison, OpenApiState, ServiceOperationView } from '@orchestrator/shared-types';
import { and, asc, eq } from 'drizzle-orm';
import { parse as parseYaml } from 'yaml';
import type { OrgAccess } from '../auth/org.guard.js';
import type { AuthenticatedUser } from '../auth/token-verifier.js';
import { assertSafeUrl, UnsafeUrlError } from '../common/ssrf-guard.js';
import { GATEWAY_CONFIG, type GatewayConfig } from '../config/gateway-config.js';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import { ContractService } from '../observation/contract.service.js';
import { OperationCatalog } from '../observation/operation-catalog.js';
import { ActivityService } from '../orgs/activity.service.js';
import { ServiceRegistryService } from '../services/service-registry.service.js';
import type { ImportOpenApiDto } from './openapi.dto.js';

const MAX_SPEC_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

/** OpenAPI documents as the source of a service's response contracts. */
@Injectable()
export class OpenApiService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
    @Inject(ServiceRegistryService) private readonly services: ServiceRegistryService,
    @Inject(OperationCatalog) private readonly catalog: OperationCatalog,
    @Inject(ContractService) private readonly contracts: ContractService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  async state(orgId: string, serviceId: string): Promise<OpenApiState> {
    const service = await this.services.get(orgId, serviceId);
    const operations = await this.operations(serviceId);
    return {
      import: service.openapi ?? null,
      operations: operations.map(toView),
      comparisons: await this.compare(orgId, serviceId, operations),
    };
  }

  /** Replaces the service's declared operations with those of a new document. */
  async import(org: OrgAccess, serviceId: string, dto: ImportOpenApiDto, user: AuthenticatedUser): Promise<OpenApiState> {
    const service = await this.services.get(org.id, serviceId);
    const document = dto.url ? await this.download(dto.url) : dto.document;
    let parsed;
    try {
      parsed = parseOpenApi(typeof document === 'string' ? parseDocument(document) : document, {
        requiredOnly: dto.requiredOnly ?? false,
      });
    } catch (error) {
      if (error instanceof OpenApiError || error instanceof SyntaxError) throw new BadRequestException(error.message);
      throw error;
    }
    if (!parsed.operations.length)
      throw new BadRequestException('The document has no operations with a JSON 2xx response schema');

    const info: OpenApiImportInfo = {
      title: parsed.title,
      version: parsed.version,
      importedAt: new Date().toISOString(),
      importedBy: user.email ?? user.id,
      operations: parsed.operations.length,
      skipped: parsed.skipped,
      requiredOnly: dto.requiredOnly ?? false,
      sourceUrl: dto.url ?? null,
    };
    await this.db.transaction(async (tx) => {
      await tx.delete(serviceOperations).where(eq(serviceOperations.serviceId, serviceId));
      await tx.insert(serviceOperations).values(
        parsed.operations.map((operation) => ({
          orgId: org.id,
          serviceId,
          httpMethod: operation.method,
          pathTemplate: operation.path,
          operationId: operation.operationId,
          summary: operation.summary,
          responseStatus: operation.status,
          schemaTokens: operation.tokens,
        })),
      );
      await tx
        .update(serviceRegistries)
        .set({ openapi: info, updatedAt: new Date() })
        .where(eq(serviceRegistries.id, serviceId));
    });
    await this.catalog.evict(serviceId);
    await this.activity.record(org.id, {
      actor: info.importedBy,
      action: 'service.openapi_imported',
      targetType: 'service',
      targetId: serviceId,
      details: { service: service.serviceName, title: info.title, version: info.version, operations: info.operations },
    });
    return this.state(org.id, serviceId);
  }

  async remove(org: OrgAccess, serviceId: string, user: AuthenticatedUser): Promise<void> {
    const service = await this.services.get(org.id, serviceId);
    await this.db.transaction(async (tx) => {
      await tx.delete(serviceOperations).where(eq(serviceOperations.serviceId, serviceId));
      await tx
        .update(serviceRegistries)
        .set({ openapi: null, updatedAt: new Date() })
        .where(eq(serviceRegistries.id, serviceId));
    });
    await this.catalog.evict(serviceId);
    await this.activity.record(org.id, {
      actor: user.email ?? user.id,
      action: 'service.openapi_removed',
      targetType: 'service',
      targetId: serviceId,
      details: { service: service.serviceName },
    });
  }

  /** Re-baselines a consumer contract on the spec (a new contract version; the old is kept). */
  async adopt(org: OrgAccess, serviceId: string, contractId: string, user: AuthenticatedUser): Promise<OpenApiState> {
    const operations = await this.operations(serviceId);
    const [contract] = await this.db
      .select()
      .from(apiContracts)
      .where(
        and(
          eq(apiContracts.id, contractId),
          eq(apiContracts.orgId, org.id),
          eq(apiContracts.serviceId, serviceId),
          eq(apiContracts.isActive, true),
        ),
      );
    if (!contract) throw new NotFoundException('Active contract not found for this service');
    const operation = findOperation(
      operations.map((op) => ({ ...op, method: op.httpMethod, path: op.pathTemplate })),
      contract.httpMethod,
      contract.endpointPath,
    );
    if (!operation) throw new BadRequestException('The imported spec does not cover this endpoint');
    await this.contracts.replaceBaseline(org.id, contractId, operation.schemaTokens, 'openapi');
    await this.activity.record(org.id, {
      actor: user.email ?? user.id,
      action: 'contract.openapi_adopted',
      targetType: 'contract',
      targetId: contractId,
      details: { endpoint: `${contract.httpMethod} ${contract.endpointPath}`, operation: operation.pathTemplate },
    });
    return this.state(org.id, serviceId);
  }

  private operations(serviceId: string): Promise<ServiceOperation[]> {
    return this.db
      .select()
      .from(serviceOperations)
      .where(eq(serviceOperations.serviceId, serviceId))
      .orderBy(asc(serviceOperations.pathTemplate), asc(serviceOperations.httpMethod));
  }

  /** Active consumer contracts whose endpoint the spec covers, with how they differ. */
  private async compare(orgId: string, serviceId: string, operations: ServiceOperation[]): Promise<ContractComparison[]> {
    if (!operations.length) return [];
    const rows = await this.db
      .select({ contract: apiContracts, consumerName: consumers.name })
      .from(apiContracts)
      .innerJoin(consumers, eq(apiContracts.consumerId, consumers.id))
      .where(and(eq(apiContracts.orgId, orgId), eq(apiContracts.serviceId, serviceId), eq(apiContracts.isActive, true)))
      .orderBy(asc(consumers.name), asc(apiContracts.endpointPath));
    const candidates = operations.map((op) => ({ ...op, method: op.httpMethod, path: op.pathTemplate }));
    const comparisons: ContractComparison[] = [];
    for (const { contract, consumerName } of rows) {
      const operation = findOperation(candidates, contract.httpMethod, contract.endpointPath);
      if (!operation) continue;
      const declared = new Set(operation.schemaTokens);
      const observed = new Set(contract.schemaSnapshot as string[]);
      comparisons.push({
        contractId: contract.id,
        consumerId: contract.consumerId,
        consumerName,
        httpMethod: contract.httpMethod,
        endpointPath: contract.endpointPath,
        source: contract.source,
        operationId: operation.id,
        pathTemplate: operation.pathTemplate,
        missingFromContract: [...declared].filter((token) => !observed.has(token)).sort(),
        notInSpec: [...observed].filter((token) => !declared.has(token)).sort(),
      });
    }
    return comparisons;
  }

  /** Fetches a spec URL through the SSRF guard, with a size cap. */
  private async download(raw: string): Promise<string> {
    try {
      const url = await assertSafeUrl(raw, this.config.allowPrivateUpstreams);
      const response = await this.services.guardedFetch(url, {
        headers: { accept: 'application/json, application/yaml;q=0.9, */*;q=0.5' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) throw new BadRequestException(`Fetching the spec returned HTTP ${response.status}`);
      const declared = Number(response.headers.get('content-length') ?? 0);
      if (declared > MAX_SPEC_BYTES) throw new BadRequestException('The spec is larger than 5 MB');
      const text = await response.text();
      if (Buffer.byteLength(text) > MAX_SPEC_BYTES) throw new BadRequestException('The spec is larger than 5 MB');
      return text;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (error instanceof UnsafeUrlError) throw new BadRequestException(error.message);
      const cause = (error as { cause?: unknown }).cause;
      throw new BadRequestException(
        `Could not fetch the spec: ${cause instanceof Error ? cause.message : error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/** JSON or YAML text (YAML is a superset of JSON). */
function parseDocument(text: string): unknown {
  try {
    return parseYaml(text, { maxAliasCount: 100 });
  } catch (error) {
    throw new OpenApiError(`Not valid JSON or YAML: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  }
}

function toView(operation: ServiceOperation): ServiceOperationView {
  return {
    id: operation.id,
    httpMethod: operation.httpMethod,
    pathTemplate: operation.pathTemplate,
    operationId: operation.operationId,
    summary: operation.summary,
    responseStatus: operation.responseStatus,
    schemaTokens: operation.schemaTokens,
  };
}
