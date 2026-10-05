import { Module } from '@nestjs/common';
import { GatewayClientService } from './gateway-client/gateway-client.service.js';
import { ReportsController } from './reports/reports.controller.js';
import { ReportsService } from './reports/reports.service.js';

@Module({
  providers: [GatewayClientService, ReportsService],
  controllers: [ReportsController],
})
export class AppModule {}
