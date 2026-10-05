import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { ObservationModule } from '../observation/observation.module.js';
import { OpenApiController } from './openapi.controller.js';
import { OpenApiService } from './openapi.service.js';

@Module({
  imports: [DatabaseModule, ObservationModule],
  controllers: [OpenApiController],
  providers: [OpenApiService],
})
export class OpenApiModule {}
