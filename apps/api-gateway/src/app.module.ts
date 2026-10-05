import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module.js';
import { GatewayConfigModule } from './config/config.module.js';
import { CommonModule } from './common/common.module.js';
import { ConsumersModule } from './consumers/consumers.module.js';
import { DemoModule } from './demo/demo.module.js';
import { EventsModule } from './events/events.module.js';
import { GovernanceModule } from './governance/governance.module.js';
import { HealthModule } from './health/health.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { OpenApiModule } from './openapi/openapi.module.js';
import { OrgsModule } from './orgs/orgs.module.js';
import { PoliciesModule } from './policies/policies.module.js';
import { ProxyModule } from './proxy/proxy.module.js';
import { ServicesModule } from './services/services.module.js';

@Module({
  imports: [
    // Rate limiting: 50 requests per minute per user for management API
    ThrottlerModule.forRoot([
      {
        name: 'management',
        ttl: 60 * 1000, // 60 seconds
        limit: 50, // 50 requests per minute
      },
      {
        name: 'default',
        ttl: 60 * 1000,
        limit: 100, // Default for all routes
      },
    ]),
    GatewayConfigModule,
    CommonModule,
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
    OpenApiModule,
    HealthModule,
  ],
})
export class AppModule {}
