import { Controller, Get } from '@nestjs/common';
import { ReportsService } from '../reports/reports.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  async health() {
    await this.reports.checkHealth();
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    await this.reports.checkHealth();
    return { status: 'ready' };
  }
}
