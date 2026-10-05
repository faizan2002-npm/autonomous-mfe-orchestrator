import { Module } from '@nestjs/common';
import { CanaryModule } from '../canary/canary.module.js';
import { CognitiveModule } from '../cognitive/cognitive.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { HealingService } from './healing.service.js';

@Module({
  imports: [CognitiveModule, CanaryModule, RedisModule],
  providers: [HealingService],
  exports: [HealingService],
})
export class HealingModule {}
