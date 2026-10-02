import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { GatewayConfigModule } from './config/config.module.js';
import { ConsumersModule } from './consumers/consumers.module.js';
import { DemoModule } from './demo/demo.module.js';
import { EventsModule } from './events/events.module.js';
import { GovernanceModule } from './governance/governance.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { OrgsModule } from './orgs/orgs.module.js';
import { PoliciesModule } from './policies/policies.module.js';
import { ProxyModule } from './proxy/proxy.module.js';
import { ServicesModule } from './services/services.module.js';

@Module({
  imports: [
    GatewayConfigModule,
    EventsModule,
    AuthModule,
    OrgsModule,
    ServicesModule,
    ConsumersModule,
    GovernanceModule,
    ProxyModule,
    DemoModule,
    NotificationsModule,
    PoliciesModule,
  ],
})
export class AppModule {}
