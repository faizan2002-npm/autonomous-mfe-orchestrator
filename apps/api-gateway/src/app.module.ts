import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { GatewayConfigModule } from './config/config.module.js';
import { DemoModule } from './demo/demo.module.js';
import { EventsModule } from './events/events.module.js';
import { GovernanceModule } from './governance/governance.module.js';
import { ProxyModule } from './proxy/proxy.module.js';

@Module({
  imports: [
    GatewayConfigModule,
    EventsModule,
    AuthModule,
    GovernanceModule,
    ProxyModule,
    DemoModule,
  ],
})
export class AppModule {}
