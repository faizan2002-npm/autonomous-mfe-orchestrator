import { Module } from '@nestjs/common';
import { CanaryModule } from '../canary/canary.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { GovernanceModule } from '../governance/governance.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { PoliciesController } from './policies.controller.js';
import { PoliciesService } from './policies.service.js';
import { PolicyEvaluator } from './policy-evaluator.js';

@Module({
  imports: [DatabaseModule, RedisModule, CanaryModule, GovernanceModule],
  controllers: [PoliciesController],
  providers: [PoliciesService, PolicyEvaluator],
  exports: [PoliciesService, PolicyEvaluator],
})
export class PoliciesModule {}
