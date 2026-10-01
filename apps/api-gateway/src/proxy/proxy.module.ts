import { ProxyService } from './proxy.service.js';
import { Module } from '@nestjs/common';
import { ProxyController } from './proxy.controller.js';
import { ObservationModule } from '../observation/observation.module.js';
import { CanaryModule } from '../canary/canary.module.js';

@Module({
  imports: [ObservationModule, CanaryModule],
  providers: [ProxyService],
  controllers: [ProxyController],
})
export class ProxyModule {}
