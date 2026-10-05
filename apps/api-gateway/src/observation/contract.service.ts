import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { flattenPayload, type FieldPins } from '@orchestrator/core';
import {
  apiContracts,
  serviceRegistries,
  type DrizzleDb,
} from '@orchestrator/database';
import { and, desc, eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { contractKey, type ContractRef } from '../common/contract-ref.js';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import { REDIS_CLIENT } from '../redis/redis.tokens.js';
import { OperationCatalog } from './operation-catalog.js';

const CONTRACT_CACHE_TTL_SECONDS = 86_400;

export interface ObservedResponse extends ContractRef {
  serviceId: string;
  observedPayload: unknown;
}

export interface ContractBaseline {
  serviceId: string;
  contractId: string;
  schemaTokens: string[];
  pinnedFields: FieldPins | null;
}

// v3: baselines are per organization and consumer, and carry field pins.
const cacheKeyOf = (contract: Omit<ContractRef, 'consumerName'>) =>
  `contract:v3:${contractKey(contract)}`;

@Injectable()
export class ContractService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(OperationCatalog) private readonly catalog: OperationCatalog,
  ) {}

  /**
   * The consumer's contract for this endpoint. It starts from the service's OpenAPI spec when
   * one covers the endpoint (so even the first response is checked); otherwise the first
   * response becomes the baseline.
   */
  async getOrCreateBaseline(
    response: ObservedResponse,
  ): Promise<ContractBaseline> {
    const cacheKey = cacheKeyOf(response);
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as ContractBaseline;

    let contract = await this.findActiveContract(response);
    if (!contract) {
      const declared = await this.catalog.match(response.serviceId, response.httpMethod, response.endpointPath);
      const schemaTokens = declared ?? Array.from(flattenPayload(response.observedPayload));
      await this.db
        .insert(apiContracts)
        .values({
          orgId: response.orgId,
          consumerId: response.consumerId,
          serviceId: response.serviceId,
          endpointPath: response.endpointPath,
          httpMethod: response.httpMethod,
          schemaSnapshot: schemaTokens,
          fieldCount: schemaTokens.length,
          version: 1,
          source: declared ? 'openapi' : 'traffic',
        })
        .onConflictDoNothing();
      // Concurrent first responses must use the baseline that actually won the insert.
      contract = await this.findActiveContract(response);
    }
    if (!contract)
      throw new Error(
        `No active contract for ${response.serviceName} ${response.endpointPath}`,
      );

    const baseline: ContractBaseline = {
      serviceId: response.serviceId,
      contractId: contract.id,
      schemaTokens: contract.schemaSnapshot as string[],
      pinnedFields: contract.pinnedFields ?? null,
    };
    await this.redis.set(
      cacheKey,
      JSON.stringify(baseline),
      'EX',
      CONTRACT_CACHE_TTL_SECONDS,
    );
    return baseline;
  }

  /** Sets which fields the consumer depends on; takes effect on the next request. */
  async updatePins(
    orgId: string,
    contractId: string,
    pins: FieldPins | null,
  ): Promise<void> {
    const [row] = await this.db
      .select({
        contract: apiContracts,
        serviceName: serviceRegistries.serviceName,
      })
      .from(apiContracts)
      .innerJoin(
        serviceRegistries,
        eq(apiContracts.serviceId, serviceRegistries.id),
      )
      .where(
        and(eq(apiContracts.id, contractId), eq(apiContracts.orgId, orgId)),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Contract not found');
    await this.db
      .update(apiContracts)
      .set({ pinnedFields: pins })
      .where(eq(apiContracts.id, contractId));
    await this.redis.del(
      cacheKeyOf({
        orgId,
        consumerId: row.contract.consumerId,
        serviceName: row.serviceName,
        httpMethod: row.contract.httpMethod,
        endpointPath: row.contract.endpointPath,
      }),
    );
  }

  /**
   * Replaces a contract's baseline with a new version (e.g. the OpenAPI declaration),
   * keeping the old one for history. Takes effect on the next request.
   */
  async replaceBaseline(
    orgId: string,
    contractId: string,
    schemaTokens: string[],
    source: 'openapi' | 'traffic',
  ): Promise<string> {
    const [row] = await this.db
      .select({ contract: apiContracts, serviceName: serviceRegistries.serviceName })
      .from(apiContracts)
      .innerJoin(serviceRegistries, eq(apiContracts.serviceId, serviceRegistries.id))
      .where(and(eq(apiContracts.id, contractId), eq(apiContracts.orgId, orgId), eq(apiContracts.isActive, true)))
      .limit(1);
    if (!row) throw new NotFoundException('Active contract not found');
    const { contract } = row;
    const replacement = await this.db.transaction(async (tx) => {
      await tx.update(apiContracts).set({ isActive: false }).where(eq(apiContracts.id, contractId));
      const [created] = await tx
        .insert(apiContracts)
        .values({
          orgId,
          consumerId: contract.consumerId,
          serviceId: contract.serviceId,
          endpointPath: contract.endpointPath,
          httpMethod: contract.httpMethod,
          schemaSnapshot: schemaTokens,
          fieldCount: schemaTokens.length,
          version: contract.version + 1,
          source,
          pinnedFields: contract.pinnedFields,
        })
        .returning({ id: apiContracts.id });
      return created!.id;
    });
    await this.redis.del(
      cacheKeyOf({
        orgId,
        consumerId: contract.consumerId,
        serviceName: row.serviceName,
        httpMethod: contract.httpMethod,
        endpointPath: contract.endpointPath,
      }),
    );
    return replacement;
  }

  private async findActiveContract(response: ObservedResponse) {
    const [contract] = await this.db
      .select()
      .from(apiContracts)
      .where(
        and(
          eq(apiContracts.serviceId, response.serviceId),
          eq(apiContracts.consumerId, response.consumerId),
          eq(apiContracts.endpointPath, response.endpointPath),
          eq(apiContracts.httpMethod, response.httpMethod),
          eq(apiContracts.isActive, true),
        ),
      )
      .orderBy(desc(apiContracts.version))
      .limit(1);
    return contract;
  }
}
