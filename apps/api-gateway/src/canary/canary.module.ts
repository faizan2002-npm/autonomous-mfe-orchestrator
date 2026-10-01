import { RedisModule } from '../redis/redis.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { Module } from '@nestjs/common';
import { CanaryService } from './canary.service.js';
import { CanaryController } from './canary.controller.js';

@Module({
  imports: [DatabaseModule, RedisModule],
  controllers: [CanaryController],
  providers: [CanaryService],
  exports: [CanaryService],
})
export class CanaryModule {}
