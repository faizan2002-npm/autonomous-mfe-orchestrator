import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { CanaryMetricsService } from './canary-metrics.service.js';
import { CanaryController } from './canary.controller.js';
import { CanaryService } from './canary.service.js';

@Module({
  imports: [DatabaseModule, RedisModule],
  controllers: [CanaryController],
  providers: [CanaryService, CanaryMetricsService],
  exports: [CanaryService, CanaryMetricsService],
})
export class CanaryModule {}
