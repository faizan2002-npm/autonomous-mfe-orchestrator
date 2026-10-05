import { Module } from '@nestjs/common';
import { CanaryModule } from '../canary/canary.module.js';
import { ObservationModule } from '../observation/observation.module.js';
import { ProxyController } from './proxy.controller.js';
import { ProxyService } from './proxy.service.js';

@Module({
  imports: [ObservationModule, CanaryModule],
  providers: [ProxyService],
  controllers: [ProxyController],
})
export class ProxyModule {}
