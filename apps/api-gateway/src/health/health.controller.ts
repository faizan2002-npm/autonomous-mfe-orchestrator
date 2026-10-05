import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthService, type HealthStatus } from './health.service.js';

/**
 * Health check endpoints for load balancers and Kubernetes.
 * GET /health — returns 200/503 based on overall health
 */
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  async check(@Res() res: Response): Promise<void> {
    const status = await this.health.check();
    const statusCode = status.status === 'unhealthy' ? 503 : 200;
    res.status(statusCode).json(status);
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
   * Returns 503 if any critical dependency is down.
   */
  @Get('ready')
  async readiness(@Res() res: Response): Promise<void> {
    const status = await this.health.check();
    const statusCode = status.status === 'unhealthy' ? 503 : 200;
    res.status(statusCode).json(status);
  }
}
