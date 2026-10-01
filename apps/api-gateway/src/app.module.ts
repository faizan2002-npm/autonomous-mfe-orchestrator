import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './config/environment.js';
import { Module } from '@nestjs/common';
import { GovernanceModule } from './governance/governance.module.js';
import { ProxyModule } from './proxy/proxy.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
      validate: validateEnvironment,
    }),
    GovernanceModule,
    ProxyModule,
  ],
})
export class AppModule {}
