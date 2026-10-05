import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { DrizzleDb } from '@orchestrator/database';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import { REDIS_CLIENT } from '../redis/redis.tokens.js';
import { ServiceRegistryService } from '../services/service-registry.service.js';

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: {
    database: HealthCheckResult;
    redis: HealthCheckResult;
  };
}

export interface HealthCheckResult {
  status: 'up' | 'down';
  responseTimeMs?: number;
}

export interface UpstreamHealthStatus {
  name: string;
  url: string;
  status: 'up' | 'down' | 'unknown';
  responseTimeMs?: number;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private shuttingDown = false;

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(ServiceRegistryService) private readonly services: ServiceRegistryService,
  ) {}

  async check(): Promise<HealthStatus> {
    // During shutdown, readiness probe should return unhealthy to drain traffic
    if (this.shuttingDown) {
      return {
        status: 'unhealthy',
        checks: {
          database: { status: 'down' },
          redis: { status: 'down' },
        },
      };
    }

    const dbCheck = await this.checkDatabase();
    const redisCheck = await this.checkRedis();

    const status =
      dbCheck.status === 'up' && redisCheck.status === 'up'
        ? 'healthy'
        : dbCheck.status === 'up' || redisCheck.status === 'up'
          ? 'degraded'
          : 'unhealthy';

    return {
      status,
      checks: {
        database: dbCheck,
        redis: redisCheck,
      },
    };
  }

  markShuttingDown(): void {
    this.shuttingDown = true;
    this.logger.log('Marked as shutting down, readiness probe will return 503');
  }

  private async checkDatabase(): Promise<HealthCheckResult> {
    try {
      const start = Date.now();
      // Simple query to verify database connectivity
      await this.db.query.organizations.findFirst();
      return {
        status: 'up',
        responseTimeMs: Date.now() - start,
      };
    } catch (error) {
      this.logger.error(
        `Database health check failed: ${String(error)}`,
      );
      return { status: 'down' };
    }
  }

  private async checkRedis(): Promise<HealthCheckResult> {
    try {
      const start = Date.now();
      await this.redis.ping();
      return {
        status: 'up',
        responseTimeMs: Date.now() - start,
      };
    } catch (error) {
      this.logger.error(`Redis health check failed: ${String(error)}`);
      return { status: 'down' };
    }
  }

  /**
   * Check health of registered upstream services.
   * Probes each upstream's /health endpoint with 5s timeout.
   */
  async checkUpstreams(): Promise<UpstreamHealthStatus[]> {
    const services = await this.services.getAllServices();
    const results: UpstreamHealthStatus[] = [];

    for (const service of services) {
      const healthUrl = `${service.baseUrl}/health`;
      try {
        const start = Date.now();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        try {
          const response = await fetch(healthUrl, {
            signal: controller.signal,
            redirect: 'manual',
          });
          clearTimeout(timeoutId);

          const status = response.ok ? 'up' : 'down';
          results.push({
            name: service.name,
            url: service.baseUrl,
            status,
            responseTimeMs: Date.now() - start,
          });
        } catch (error) {
          clearTimeout(timeoutId);
          throw error;
        }
      } catch (error) {
        results.push({
          name: service.name,
          url: service.baseUrl,
          status: 'down',
        });
      }
    }

    return results;
  }
}
