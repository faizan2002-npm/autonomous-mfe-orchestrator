import { Module } from '@nestjs/common';
import { ObservationService } from './observation.service.js';
import { CognitiveModule } from '../cognitive/cognitive.module.js';
import { CanaryModule } from '../canary/canary.module.js';

@Module({
  imports: [CognitiveModule, CanaryModule],
  providers: [ObservationService],
  exports: [ObservationService],
})
export class ObservationModule {}
