import { PromotePatchDto } from './promote-patch.dto.js';
import {
  Inject,
  Controller,
  Get,
  Post,
  Param,
  Body,
  ParseUUIDPipe,
  ValidationPipe,
} from '@nestjs/common';
import { GovernanceService } from './governance.service.js';
import { CanaryService } from '../canary/canary.service.js';

@Controller('api/governance')
export class GovernanceController {
  constructor(
    @Inject(GovernanceService)
    private readonly governanceService: GovernanceService,
    @Inject(CanaryService) private readonly canaryService: CanaryService,
  ) {}

  @Get('overview')
  async getOverview() {
    return this.governanceService.getOverview();
  }

  @Post('patches/:patchId/promote')
  async promotePatch(
    @Param('patchId', new ParseUUIDPipe()) patchId: string,
    @Body(
      new ValidationPipe({
        expectedType: PromotePatchDto,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    body: PromotePatchDto,
  ) {
    await this.canaryService.promotePatch(patchId, body.serviceName);
    return {
      message: `Patch ${patchId} successfully promoted to 100% production.`,
    };
  }
}
