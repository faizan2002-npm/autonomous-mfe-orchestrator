import { Inject, Injectable } from '@nestjs/common';
import { flattenPayload } from '@orchestrator/core';
import {
  apiContracts,
  serviceRegistries,
  type DrizzleDb,
} from '@orchestrator/database';
import { and, desc, eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { contractKey, type ContractRef } from '../common/contract-ref.js';
import {
  GATEWAY_CONFIG,
  type GatewayConfig,
} from '../config/gateway-config.js';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import { REDIS_CLIENT } from '../redis/redis.tokens.js';

const CONTRACT_CACHE_TTL_SECONDS = 86_400;

export interface ObservedResponse extends ContractRef {
  observedPayload: unknown;
}

export interface ContractBaseline {
  serviceId: string;
  contractId: string;
  schemaTokens: string[];
}

@Injectable()
export class ContractService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
  ) {}

  async getOrCreateBaseline(
    response: ObservedResponse,
  ): Promise<ContractBaseline> {
    // Version the key because the cache now includes the IDs matching the schema.
    const cacheKey = `contract:v2:${contractKey(response)}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as ContractBaseline;

    const serviceId = await this.getOrCreateService(response.serviceName);
    let contract = await this.findActiveContract(serviceId, response);

    if (!contract) {
      const schemaTokens = Array.from(flattenPayload(response.observedPayload));
      await this.db
        .insert(apiContracts)
        .values({
          serviceId,
          endpointPath: response.endpointPath,
          httpMethod: response.httpMethod,
          schemaSnapshot: schemaTokens,
          fieldCount: schemaTokens.length,
          version: 1,
        })
        .onConflictDoNothing();

      // Concurrent first responses must use the baseline that actually won the insert.
      contract = await this.findActiveContract(serviceId, response);
    }

    if (!contract)
      throw new Error(
        `No active contract for ${response.serviceName} ${response.endpointPath}`,
      );
    const baseline: ContractBaseline = {
      serviceId,
      contractId: contract.id,
      schemaTokens: contract.schemaSnapshot as string[],
    };
    await this.redis.set(
      cacheKey,
      JSON.stringify(baseline),
      'EX',
      CONTRACT_CACHE_TTL_SECONDS,
    );
    return baseline;
  }

  private async findActiveContract(
    serviceId: string,
    response: ObservedResponse,
  ) {
    const [contract] = await this.db
      .select()
      .from(apiContracts)
      .where(
        and(
          eq(apiContracts.serviceId, serviceId),
          eq(apiContracts.endpointPath, response.endpointPath),
          eq(apiContracts.httpMethod, response.httpMethod),
          eq(apiContracts.isActive, true),
        ),
      )
      .orderBy(desc(apiContracts.version))
      .limit(1);
    return contract;
  }

  private async getOrCreateService(serviceName: string): Promise<string> {
    const [existing] = await this.db
      .select()
      .from(serviceRegistries)
      .where(eq(serviceRegistries.serviceName, serviceName))
      .limit(1);
    if (existing) return existing.id;

    const endpointUrl = this.config.serviceEndpoints[serviceName];
    if (!endpointUrl) throw new Error(`Unknown service: ${serviceName}`);
    await this.db
      .insert(serviceRegistries)
      .values({
        serviceName,
        endpointUrl,
        serviceType: 'REST',
        mfeConsumer: 'mfe-shell',
        status: 'HEALTHY',
      })
      .onConflictDoNothing();

    const [service] = await this.db
      .select()
      .from(serviceRegistries)
      .where(eq(serviceRegistries.serviceName, serviceName))
      .limit(1);
    if (!service) throw new Error(`Could not register service: ${serviceName}`);
    return service.id;
  }
}
