import { Controller, Get, Post, Param, Body, Inject } from '@nestjs/common';
import {
  type DrizzleDb,
  serviceRegistries,
  driftEvents,
  patchRegistries,
  governanceAudits,
} from '@orchestrator/database';
import { desc } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.module.js';
import { CanaryService } from '../canary/canary.service.js';

@Controller('api/governance')
export class GovernanceController {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    private readonly canaryService: CanaryService
  ) {}

  @Get('overview')
  async getOverview() {
    const [services, events, patches, audits] = await Promise.all([
      this.db.select().from(serviceRegistries),
      this.db.select().from(driftEvents).orderBy(desc(driftEvents.detectedAt)).limit(20),
      this.db.select().from(patchRegistries).orderBy(desc(patchRegistries.createdAt)).limit(10),
      this.db.select().from(governanceAudits).orderBy(desc(governanceAudits.createdAt)).limit(10),
    ]);

    return {
      services,
      driftEvents: events,
      patches,
      audits,
    };
  }

  @Post('patches/:patchId/promote')
  async promotePatch(
    @Param('patchId') patchId: string,
    @Body() body: { serviceName: string }
  ) {
    await this.canaryService.promotePatch(patchId, body.serviceName);
    return { message: `Patch ${patchId} successfully promoted to 100% production.` };
  }
}
