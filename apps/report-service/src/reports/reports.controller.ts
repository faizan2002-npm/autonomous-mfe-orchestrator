import { Controller, Get, Param } from '@nestjs/common';
import {
  ReportsService,
  type OrgReport,
  type PatchMetrics,
  type DriftMetrics,
} from './reports.service.js';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('/:orgSlug')
  async getOrgReport(@Param('orgSlug') orgSlug: string): Promise<OrgReport> {
    return this.reports.generateOrgReport(orgSlug);
  }

  @Get('/:orgSlug/patches')
  async getPatchMetrics(@Param('orgSlug') orgSlug: string): Promise<PatchMetrics> {
    const report = await this.reports.generateOrgReport(orgSlug);
    return report.patches;
  }

  @Get('/:orgSlug/drift')
  async getDriftMetrics(@Param('orgSlug') orgSlug: string): Promise<DriftMetrics> {
    const report = await this.reports.generateOrgReport(orgSlug);
    return report.drift;
  }
}
