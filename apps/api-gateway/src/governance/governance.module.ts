import { Module } from '@nestjs/common';
import { GovernanceController } from './governance.controller.js';
import { CanaryModule } from '../canary/canary.module.js';

@Module({
  imports: [CanaryModule],
  controllers: [GovernanceController],
})
export class GovernanceModule {}
