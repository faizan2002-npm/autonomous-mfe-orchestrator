import { Inject, Injectable } from '@nestjs/common';
import { findOperation } from '@orchestrator/core';
import { serviceOperations, type DrizzleDb } from '@orchestrator/database';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import { REDIS_CLIENT } from '../redis/redis.tokens.js';

const TTL_SECONDS = 300;

interface CachedOperation {
  method: string;
  path: string;
  tokens: string[];
}

const cacheKey = (serviceId: string) => `openapi_ops:v1:${serviceId}`;

/** A service's OpenAPI-declared response contracts, looked up when a new contract is created. */
@Injectable()
export class OperationCatalog {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** The spec's schema tokens for this request, or null when the spec doesn't cover it. */
  async match(serviceId: string, method: string, path: string): Promise<string[] | null> {
    return findOperation(await this.operations(serviceId), method, path)?.tokens ?? null;
  }

  async evict(serviceId: string): Promise<void> {
    await this.redis.del(cacheKey(serviceId));
  }

  private async operations(serviceId: string): Promise<CachedOperation[]> {
    const cached = await this.redis.get(cacheKey(serviceId));
    if (cached) return JSON.parse(cached) as CachedOperation[];
    const rows = await this.db
      .select({
        method: serviceOperations.httpMethod,
        path: serviceOperations.pathTemplate,
        tokens: serviceOperations.schemaTokens,
      })
      .from(serviceOperations)
      .where(eq(serviceOperations.serviceId, serviceId));
    await this.redis.set(cacheKey(serviceId), JSON.stringify(rows), 'EX', TTL_SECONDS);
    return rows;
  }
}
