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
  ) {}

  /** The consumer's learned contract for this endpoint; its first response becomes the baseline. */
  async getOrCreateBaseline(
    response: ObservedResponse,
  ): Promise<ContractBaseline> {
    const cacheKey = cacheKeyOf(response);
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as ContractBaseline;

    let contract = await this.findActiveContract(response);
    if (!contract) {
      const schemaTokens = Array.from(flattenPayload(response.observedPayload));
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
