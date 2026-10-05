import { Controller, Get, Param } from '@nestjs/common';
import { ReportsService, type OrgReport } from './reports.service.js';

@Controller('api/reports')
export class ReportsStorageController {
  constructor(private readonly reports: ReportsService) {}

  @Get(':orgSlug')
  async getReport(@Param('orgSlug') orgSlug: string): Promise<OrgReport> {
    return this.reports.generateOrgReport(orgSlug);
  }

  @Get(':orgSlug/contracts')
  async getContractMetrics(@Param('orgSlug') orgSlug: string) {
    return this.reports.getContractHealingMetrics(orgSlug);
  }
}
