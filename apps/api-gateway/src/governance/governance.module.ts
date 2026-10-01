import { GovernanceService } from './governance.service.js';
import { Module } from '@nestjs/common';
import { GovernanceController } from './governance.controller.js';
import { CanaryModule } from '../canary/canary.module.js';

@Module({
  imports: [CanaryModule],
  providers: [GovernanceService],
  controllers: [GovernanceController],
})
export class GovernanceModule {}
