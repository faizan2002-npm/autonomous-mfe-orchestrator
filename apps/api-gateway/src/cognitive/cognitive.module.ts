import { Module } from '@nestjs/common';
import { CognitiveService } from './cognitive.service.js';

@Module({
  providers: [CognitiveService],
  exports: [CognitiveService],
})
export class CognitiveModule {}
