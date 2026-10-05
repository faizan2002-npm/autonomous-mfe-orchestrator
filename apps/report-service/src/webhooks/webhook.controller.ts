import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ReportsService } from '../reports/reports.service.js';

@Controller('api/webhooks')
export class WebhookController {
  constructor(private readonly reports: ReportsService) {}

  @Post('healing')
  @HttpCode(202)
  async ingestHealingEvent(@Body() event: Record<string, unknown>) {
    this.reports.recordHealingEvent(event);
    return { acknowledged: true };
  }
}
