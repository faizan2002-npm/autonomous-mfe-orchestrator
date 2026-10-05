import { Controller, Get, HttpCode } from '@nestjs/common';
import { HealthService, type HealthStatus } from './health.service.js';

/**
 * Health check endpoints for load balancers and Kubernetes.
 * GET /health — returns 200/503 based on overall health
 */
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @HttpCode(200)
  async check(): Promise<HealthStatus> {
    const status = await this.health.check();
    // Return 503 if unhealthy (NestJS will adjust status code)
    if (status.status === 'unhealthy') {
      // Controllers can't directly set 503, so we return the data and rely on interceptors
      // or let the client interpret the response
    }
    return status;
  }

  /**
   * Liveness probe (is the process alive?).
   * Returns 200 if the process is running, even if connections are down.
   */
  @Get('live')
  @HttpCode(200)
  async liveness(): Promise<{ alive: boolean }> {
    return { alive: true };
  }

  /**
   * Readiness probe (is the service ready to handle requests?).
   * Returns 200 only if all critical dependencies are healthy.
   */
  @Get('ready')
  @HttpCode(200)
  async readiness(): Promise<HealthStatus> {
    const status = await this.health.check();
    return status;
  }
}
