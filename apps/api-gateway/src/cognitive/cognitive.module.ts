import { DatabaseModule } from '../database/database.module.js';
import { InferenceService } from './inference.service.js';
import { Module } from '@nestjs/common';
import { CognitiveService } from './cognitive.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [InferenceService, CognitiveService],
  exports: [CognitiveService],
})
export class CognitiveModule {}
