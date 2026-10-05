import { Controller, Get, Header } from '@nestjs/common';
import { MetricsService } from './metrics.service.js';

/**
 * Exposes Prometheus metrics at GET /metrics.
 * Scraped by Prometheus or compatible monitoring systems.
 */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain')
  async getMetrics(): Promise<string> {
    return this.metrics.getMetrics();
  }
}
