import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { decryptSecret, encryptSecret } from '@orchestrator/crypto';
import {
  serviceRegistries,
  type DrizzleDb,
  type ServiceRegistry,
} from '@orchestrator/database';
import type {
  ConnectionTestResult,
  RegisteredService,
} from '@orchestrator/shared-types';
import { and, asc, eq } from 'drizzle-orm';
import type { OrgAccess } from '../auth/org.guard.js';
import type { AuthenticatedUser } from '../auth/token-verifier.js';
import {
  assertSafeUrl,
  createGuardedFetch,
  UnsafeUrlError,
} from '../common/ssrf-guard.js';
import {
  GATEWAY_CONFIG,
  type GatewayConfig,
} from '../config/gateway-config.js';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import { ActivityService } from '../orgs/activity.service.js';
import type { CreateServiceDto, UpdateServiceDto } from './services.dto.js';

/** What the proxy needs to forward a request, with secrets decrypted. */
export interface ResolvedService {
  id: string;
  orgId: string;
  serviceName: string;
  baseUrl: string;
  timeoutMs: number;
  headers: Record<string, string>;
}

const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,128}$/;
// Hop-by-hop and gateway-controlled headers an org may not override.
const FORBIDDEN_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'content-type',
]);
const CACHE_MS = 30_000;

@Injectable()
export class ServiceRegistryService {
  readonly guardedFetch: typeof fetch;
  private readonly cache = new Map<
    string,
    { at: number; value: ResolvedService | null }
  >();

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {
    this.guardedFetch = createGuardedFetch(config.allowPrivateUpstreams);
  }

  async list(orgId: string): Promise<RegisteredService[]> {
    const rows = await this.db
      .select()
      .from(serviceRegistries)
      .where(eq(serviceRegistries.orgId, orgId))
      .orderBy(asc(serviceRegistries.serviceName));
    return rows.map((row) => this.toView(row));
  }

  async create(
    org: OrgAccess,
    dto: CreateServiceDto,
    user: AuthenticatedUser,
  ): Promise<RegisteredService> {
    const baseUrl = await this.safeBaseUrl(dto.baseUrl);
    const [row] = await this.db
      .insert(serviceRegistries)
      .values({
        orgId: org.id,
        serviceName: dto.serviceName,
        endpointUrl: baseUrl,
        description: dto.description ?? null,
        healthPath: dto.healthPath ?? null,
        timeoutMs: dto.timeoutMs ?? 10_000,
        upstreamHeadersEnc: this.sealHeaders(dto.upstreamHeaders),
      })
      .onConflictDoNothing()
      .returning();
    if (!row)
      throw new ConflictException(
        `A service named "${dto.serviceName}" already exists`,
      );
    await this.activity.record(org.id, {
      actor: user.email ?? user.id,
      action: 'service.created',
      targetType: 'service',
      targetId: dto.serviceName,
      details: { baseUrl },
    });
    return this.toView(row);
  }

  async update(
    org: OrgAccess,
    serviceId: string,
    dto: UpdateServiceDto,
    user: AuthenticatedUser,
  ): Promise<RegisteredService> {
    const existing = await this.get(org.id, serviceId);
    const changes: Partial<typeof serviceRegistries.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (dto.baseUrl !== undefined)
      changes.endpointUrl = await this.safeBaseUrl(dto.baseUrl);
    if (dto.description !== undefined)
      changes.description = dto.description || null;
    if (dto.healthPath !== undefined)
      changes.healthPath = dto.healthPath || null;
    if (dto.timeoutMs !== undefined) changes.timeoutMs = dto.timeoutMs;
    if (dto.upstreamHeaders !== undefined)
      changes.upstreamHeadersEnc = this.sealHeaders(dto.upstreamHeaders);
    const [row] = await this.db
      .update(serviceRegistries)
      .set(changes)
      .where(eq(serviceRegistries.id, existing.id))
      .returning();
    this.forget(org.id, existing.serviceName);
    await this.activity.record(org.id, {
      actor: user.email ?? user.id,
      action: 'service.updated',
      targetType: 'service',
      targetId: existing.serviceName,
      details: { changed: Object.keys(dto) },
    });
    return this.toView(row);
  }

  async remove(
    org: OrgAccess,
    serviceId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    const existing = await this.get(org.id, serviceId);
    await this.db
      .delete(serviceRegistries)
      .where(eq(serviceRegistries.id, existing.id));
    this.forget(org.id, existing.serviceName);
    await this.activity.record(org.id, {
      actor: user.email ?? user.id,
      action: 'service.deleted',
      targetType: 'service',
      targetId: existing.serviceName,
    });
  }

  async testConnection(
    orgId: string,
    serviceId: string,
  ): Promise<ConnectionTestResult> {
    const service = await this.get(orgId, serviceId);
    const url = `${service.endpointUrl.replace(/\/$/, '')}${service.healthPath ?? '/'}`;
    const started = performance.now();
    try {
      const response = await this.guardedFetch(url, {
        headers: this.openHeaders(service.upstreamHeadersEnc),
        signal: AbortSignal.timeout(service.timeoutMs),
        redirect: 'manual',
      });
      return {
        ok: response.status < 500,
        status: response.status,
        latencyMs: Math.round(performance.now() - started),
        error: null,
      };
    } catch (error) {
      return {
        ok: false,
        status: null,
        latencyMs: null,
        error: describe(error),
      };
    }
  }

  /** Hot path for the proxy: cached briefly per org and service name. */
  async resolve(
    orgId: string,
    serviceName: string,
  ): Promise<ResolvedService | null> {
    const key = `${orgId}:${serviceName}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const [row] = await this.db
      .select()
      .from(serviceRegistries)
      .where(
        and(
          eq(serviceRegistries.orgId, orgId),
          eq(serviceRegistries.serviceName, serviceName),
        ),
      )
      .limit(1);
    const value = row
      ? {
          id: row.id,
          orgId: row.orgId,
          serviceName: row.serviceName,
          baseUrl: row.endpointUrl,
          timeoutMs: row.timeoutMs,
          headers: this.openHeaders(row.upstreamHeadersEnc),
        }
      : null;
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  async get(orgId: string, serviceId: string): Promise<ServiceRegistry> {
    const [row] = await this.db
      .select()
      .from(serviceRegistries)
      .where(
        and(
          eq(serviceRegistries.id, serviceId),
          eq(serviceRegistries.orgId, orgId),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Service not found');
    return row;
  }

  private forget(orgId: string, serviceName: string): void {
    this.cache.delete(`${orgId}:${serviceName}`);
  }

  private async safeBaseUrl(raw: string): Promise<string> {
    try {
      const url = await assertSafeUrl(raw, this.config.allowPrivateUpstreams);
      return url.toString().replace(/\/$/, '');
    } catch (error) {
      if (error instanceof UnsafeUrlError)
        throw new BadRequestException(`baseUrl: ${error.message}`);
      throw error;
    }
  }

  private sealHeaders(
    headers: Record<string, string> | undefined,
  ): string | null {
    if (!headers || !Object.keys(headers).length) return null;
    for (const [name, value] of Object.entries(headers)) {
      if (!HEADER_NAME.test(name) || FORBIDDEN_HEADERS.has(name.toLowerCase()))
        throw new BadRequestException(`Header "${name}" is not allowed`);
      if (
        typeof value !== 'string' ||
        /[\r\n]/.test(value) ||
        value.length > 4096
      )
        throw new BadRequestException(`Header "${name}" has an invalid value`);
    }
    return encryptSecret(JSON.stringify(headers), this.config.encryptionKey);
  }

  private openHeaders(sealed: string | null): Record<string, string> {
    return sealed
      ? (JSON.parse(decryptSecret(sealed, this.config.encryptionKey)) as Record<
          string,
          string
        >)
      : {};
  }

  private toView(row: ServiceRegistry): RegisteredService {
    return {
      id: row.id,
      serviceName: row.serviceName,
      baseUrl: row.endpointUrl,
      description: row.description,
      healthPath: row.healthPath,
      timeoutMs: row.timeoutMs,
      upstreamHeaderNames: Object.keys(
        this.openHeaders(row.upstreamHeadersEnc),
      ),
      status: row.status,
      openapi: row.openapi ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

function describe(error: unknown): string {
  const cause = (error as { cause?: unknown })?.cause;
  if (cause instanceof Error) return cause.message;
  return error instanceof Error ? error.message : String(error);
}
