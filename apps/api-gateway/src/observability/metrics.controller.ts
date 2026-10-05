import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { MetricsService } from './metrics.service.js';
import { AuthGuard } from '../auth/auth.guard.js';

/**
 * Exposes Prometheus metrics at GET /metrics.
 * Scraped by Prometheus or compatible monitoring systems.
 */
@Controller('metrics')
@ApiTags('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @ApiOperation({ summary: 'Prometheus metrics', description: 'Returns Prometheus-formatted metrics for monitoring' })
  @ApiResponse({ status: 200, description: 'Prometheus metrics in text format' })
  @ApiBearerAuth('bearer')
  @UseGuards(AuthGuard)
  @Header('Content-Type', 'text/plain')
  async getMetrics(): Promise<string> {
    return this.metrics.getMetrics();
  }
}
