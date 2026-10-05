import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { HealingModule } from '../healing/healing.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { ContractService } from './contract.service.js';
import { ObservationService } from './observation.service.js';
import { OperationCatalog } from './operation-catalog.js';

@Module({
  imports: [DatabaseModule, RedisModule, HealingModule],
  providers: [ContractService, ObservationService, OperationCatalog],
  exports: [ObservationService, ContractService, OperationCatalog],
})
export class ObservationModule {}
