import { RedisModule } from '../redis/redis.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { ContractService } from './contract.service.js';
import { HealingService } from './healing.service.js';
import { Module } from '@nestjs/common';
import { ObservationService } from './observation.service.js';
import { CognitiveModule } from '../cognitive/cognitive.module.js';
import { CanaryModule } from '../canary/canary.module.js';

@Module({
  imports: [DatabaseModule, RedisModule, CognitiveModule, CanaryModule],
  providers: [ObservationService, HealingService, ContractService],
  exports: [ObservationService],
})
export class ObservationModule {}
