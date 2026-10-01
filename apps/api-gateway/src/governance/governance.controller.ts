import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { GovernanceService } from './governance.service.js';
import { CanaryService } from '../canary/canary.service.js';

@Controller('api/governance')
export class GovernanceController {
  constructor(
    private readonly governanceService: GovernanceService,
    private readonly canaryService: CanaryService
  ) {}

  @Get('overview')
  async getOverview() {
    return this.governanceService.getOverview();
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
