import { Module } from '@nestjs/common';
import { CanaryService } from './canary.service.js';
import { CanaryController } from './canary.controller.js';

@Module({
  controllers: [CanaryController],
  providers: [CanaryService],
  exports: [CanaryService],
})
export class CanaryModule {}
