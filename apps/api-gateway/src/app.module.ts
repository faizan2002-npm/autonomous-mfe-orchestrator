import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module.js';
import { ObservationModule } from './observation/observation.module.js';
import { CognitiveModule } from './cognitive/cognitive.module.js';
import { CanaryModule } from './canary/canary.module.js';
import { GovernanceModule } from './governance/governance.module.js';
import { ProxyModule } from './proxy/proxy.module.js';

@Module({
  imports: [
    DatabaseModule,
    ObservationModule,
    CognitiveModule,
    CanaryModule,
    GovernanceModule,
    ProxyModule,
  ],
})
export class AppModule {}
