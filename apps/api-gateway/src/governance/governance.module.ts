import { Module } from '@nestjs/common';
import { CanaryModule } from '../canary/canary.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { GovernanceQueryService } from './governance-query.service.js';
import { GovernanceController } from './governance.controller.js';
import { GovernanceService } from './governance.service.js';

@Module({
  imports: [DatabaseModule, CanaryModule],
  providers: [GovernanceService, GovernanceQueryService],
  controllers: [GovernanceController],
})
export class GovernanceModule {}
