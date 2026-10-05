import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { generateApiKey, hashToken } from '@orchestrator/crypto';
import {
  consumerKeys,
  consumerServices,
  consumers,
  organizations,
  serviceRegistries,
  type ConsumerKey,
  type DrizzleDb,
} from '@orchestrator/database';
import type {
  ConsumerKeyView,
  ConsumerKind,
  ConsumerView,
  IssuedKey,
  KeyType,
} from '@orchestrator/shared-types';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { Redis } from 'ioredis';
import type { OrgAccess } from '../auth/org.guard.js';
import type { AuthenticatedUser } from '../auth/token-verifier.js';
import {
  GATEWAY_CONFIG,
  type GatewayConfig,
} from '../config/gateway-config.js';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import { ActivityService } from '../orgs/activity.service.js';
import { REDIS_CLIENT } from '../redis/redis.tokens.js';
import type {
  CreateConsumerDto,
  IssueKeyDto,
  UpdateConsumerDto,
} from './consumers.dto.js';

/** Everything the proxy needs to authorize a request, cached by key hash. */
export interface ResolvedConsumer {
  keyId: string;
  keyType: KeyType;
  allowedOrigins: string[];
  orgId: string;
  orgSlug: string;
  consumerId: string;
  consumerName: string;
  kind: ConsumerKind;
  serviceIds: string[];
}

const KEY_CACHE_SECONDS = 60;
const cacheKey = (hash: string) => `consumer_key:${hash}`;

@Injectable()
export class ConsumersService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  async list(orgId: string): Promise<ConsumerView[]> {
    const rows = await this.db
      .select()
      .from(consumers)
      .where(eq(consumers.orgId, orgId))
      .orderBy(asc(consumers.name));
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const [grants, keys] = await Promise.all([
      this.db
        .select()
        .from(consumerServices)
        .where(inArray(consumerServices.consumerId, ids)),
      this.db
        .select()
        .from(consumerKeys)
        .where(inArray(consumerKeys.consumerId, ids))
        .orderBy(asc(consumerKeys.createdAt)),
    ]);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      description: row.description,
      serviceIds: grants
        .filter((g) => g.consumerId === row.id)
        .map((g) => g.serviceId),
      keys: keys.filter((k) => k.consumerId === row.id).map(toKeyView),
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async create(
    org: OrgAccess,
    dto: CreateConsumerDto,
    user: AuthenticatedUser,
  ): Promise<ConsumerView> {
    const serviceIds = await this.ownedServiceIds(org.id, dto.serviceIds ?? []);
    const consumer = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(consumers)
        .values({
          orgId: org.id,
          name: dto.name,
          kind: dto.kind,
          description: dto.description ?? null,
        })
        .onConflictDoNothing()
        .returning();
      if (!created)
        throw new ConflictException(
          `A consumer named "${dto.name}" already exists`,
        );
      if (serviceIds.length)
        await tx
          .insert(consumerServices)
          .values(
            serviceIds.map((serviceId) => ({
              consumerId: created.id,
              serviceId,
            })),
          );
      return created;
    });
    await this.activity.record(org.id, {
      actor: actorOf(user),
      action: 'consumer.created',
      targetType: 'consumer',
      targetId: dto.name,
      details: { kind: dto.kind },
    });
    return (await this.list(org.id)).find((c) => c.id === consumer.id)!;
  }

  async update(
    org: OrgAccess,
    consumerId: string,
    dto: UpdateConsumerDto,
    user: AuthenticatedUser,
  ): Promise<ConsumerView> {
    const consumer = await this.get(org.id, consumerId);
    await this.db.transaction(async (tx) => {
      if (dto.description !== undefined)
        await tx
          .update(consumers)
          .set({ description: dto.description || null })
          .where(eq(consumers.id, consumerId));
      if (dto.serviceIds !== undefined) {
        const serviceIds = await this.ownedServiceIds(org.id, dto.serviceIds);
        await tx
          .delete(consumerServices)
          .where(eq(consumerServices.consumerId, consumerId));
        if (serviceIds.length)
          await tx
            .insert(consumerServices)
            .values(serviceIds.map((serviceId) => ({ consumerId, serviceId })));
      }
    });
    // Cached key resolutions carry the grants, so they must not outlive this change.
    await this.evictKeys(consumerId);
    await this.activity.record(org.id, {
      actor: actorOf(user),
      action: 'consumer.updated',
      targetType: 'consumer',
      targetId: consumer.name,
      details: { changed: Object.keys(dto) },
    });
    return (await this.list(org.id)).find((c) => c.id === consumerId)!;
  }

  async remove(
    org: OrgAccess,
    consumerId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    const consumer = await this.get(org.id, consumerId);
    await this.evictKeys(consumerId);
    await this.db.delete(consumers).where(eq(consumers.id, consumerId));
    await this.activity.record(org.id, {
      actor: actorOf(user),
      action: 'consumer.deleted',
      targetType: 'consumer',
      targetId: consumer.name,
    });
  }

  async issueKey(
    org: OrgAccess,
    consumerId: string,
    dto: IssueKeyDto,
    user: AuthenticatedUser,
  ): Promise<IssuedKey> {
    const consumer = await this.get(org.id, consumerId);
    const allowedOrigins = [...new Set(dto.allowedOrigins ?? [])];
    if (dto.type === 'publishable') {
      if (consumer.kind !== 'frontend')
        throw new BadRequestException(
          'Publishable keys are for frontend consumers; use a secret key',
        );
      if (!allowedOrigins.length)
        throw new BadRequestException(
          'Publishable keys need at least one allowed origin',
        );
    }
    const { key, display } = generateApiKey(dto.type);
    const [row] = await this.db
      .insert(consumerKeys)
      .values({
        orgId: org.id,
        consumerId,
        type: dto.type,
        prefix: display,
        keyHash: hashToken(key, this.config.keyPepper),
        allowedOrigins: dto.type === 'publishable' ? allowedOrigins : [],
        createdBy: actorOf(user),
      })
      .returning();
    await this.activity.record(org.id, {
      actor: actorOf(user),
      action: 'key.issued',
      targetType: 'consumer',
      targetId: consumer.name,
      details: { type: dto.type, key: display },
    });
    return { ...toKeyView(row), key };
  }

  async revokeKey(
    org: OrgAccess,
    keyId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    const [row] = await this.db
      .update(consumerKeys)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(consumerKeys.id, keyId),
          eq(consumerKeys.orgId, org.id),
          isNull(consumerKeys.revokedAt),
        ),
      )
      .returning();
    if (!row) throw new NotFoundException('Key not found');
    await this.redis.del(cacheKey(row.keyHash));
    await this.activity.record(org.id, {
      actor: actorOf(user),
      action: 'key.revoked',
      targetType: 'key',
      targetId: row.prefix,
    });
  }

  /** Authenticates a raw API key. Returns null for unknown or revoked keys. */
  async resolveKey(rawKey: string): Promise<ResolvedConsumer | null> {
    const hash = hashToken(rawKey, this.config.keyPepper);
    const cached = await this.redis.get(cacheKey(hash));
    if (cached)
      return cached === 'null'
        ? null
        : (JSON.parse(cached) as ResolvedConsumer);

    const [row] = await this.db
      .select({
        key: consumerKeys,
        consumerName: consumers.name,
        kind: consumers.kind,
        orgSlug: organizations.slug,
      })
      .from(consumerKeys)
      .innerJoin(consumers, eq(consumerKeys.consumerId, consumers.id))
      .innerJoin(organizations, eq(consumerKeys.orgId, organizations.id))
      .where(
        and(eq(consumerKeys.keyHash, hash), isNull(consumerKeys.revokedAt)),
      )
      .limit(1);
    let resolved: ResolvedConsumer | null = null;
    if (row) {
      const grants = await this.db
        .select({ serviceId: consumerServices.serviceId })
        .from(consumerServices)
        .where(eq(consumerServices.consumerId, row.key.consumerId));
      resolved = {
        keyId: row.key.id,
        keyType: row.key.type,
        allowedOrigins: row.key.allowedOrigins,
        orgId: row.key.orgId,
        orgSlug: row.orgSlug,
        consumerId: row.key.consumerId,
        consumerName: row.consumerName,
        kind: row.kind,
        serviceIds: grants.map((g) => g.serviceId),
      };
    }
    // Negative results are cached too, so invalid keys cannot hammer the database.
    await this.redis.set(
      cacheKey(hash),
      resolved ? JSON.stringify(resolved) : 'null',
      'EX',
      KEY_CACHE_SECONDS,
    );
    return resolved;
  }

  /** Records key usage at most once a minute per key. */
  async touchKey(keyId: string): Promise<void> {
    const first = await this.redis.set(
      `consumer_key_used:${keyId}`,
      '1',
      'EX',
      60,
      'NX',
    );
    if (first === 'OK')
      await this.db
        .update(consumerKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(consumerKeys.id, keyId));
  }

  async get(orgId: string, consumerId: string) {
    const [row] = await this.db
      .select()
      .from(consumers)
      .where(and(eq(consumers.id, consumerId), eq(consumers.orgId, orgId)))
      .limit(1);
    if (!row) throw new NotFoundException('Consumer not found');
    return row;
  }

  private async ownedServiceIds(
    orgId: string,
    serviceIds: string[],
  ): Promise<string[]> {
    const unique = [...new Set(serviceIds)];
    if (!unique.length) return [];
    const owned = await this.db
      .select({ id: serviceRegistries.id })
      .from(serviceRegistries)
      .where(
        and(
          eq(serviceRegistries.orgId, orgId),
          inArray(serviceRegistries.id, unique),
        ),
      );
    if (owned.length !== unique.length)
      throw new BadRequestException('Unknown service in serviceIds');
    return unique;
  }

  private async evictKeys(consumerId: string): Promise<void> {
    const keys = await this.db
      .select({ hash: consumerKeys.keyHash })
      .from(consumerKeys)
      .where(eq(consumerKeys.consumerId, consumerId));
    if (keys.length) await this.redis.del(keys.map((k) => cacheKey(k.hash)));
  }
}

const actorOf = (user: AuthenticatedUser) => user.email ?? user.id;

function toKeyView(row: ConsumerKey): ConsumerKeyView {
  return {
    id: row.id,
    type: row.type,
    display: row.prefix,
    allowedOrigins: row.allowedOrigins,
    createdBy: row.createdBy,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
