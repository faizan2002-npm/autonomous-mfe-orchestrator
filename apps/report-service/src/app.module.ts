import { Module } from '@nestjs/common';
import { GatewayClientService } from './gateway-client/gateway-client.service.js';
import { ReportsController } from './reports/reports.controller.js';
import { ReportsStorageController } from './reports/reports-storage.controller.js';
import { ReportsService } from './reports/reports.service.js';
import { HealthController } from './health/health.controller.js';
import { WebhookController } from './webhooks/webhook.controller.js';

@Module({
  providers: [GatewayClientService, ReportsService],
  controllers: [
    ReportsController,
    ReportsStorageController,
    HealthController,
    WebhookController,
  ],
})
export class AppModule {}
