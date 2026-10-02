import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GATEWAY_CONFIG, loadGatewayConfig } from './gateway-config.js';

/** Loads .env files, then exposes one validated, typed config object to every module. */
@Global()
@Module({
  imports: [ConfigModule.forRoot({ envFilePath: ['.env', '../../.env'] })],
  providers: [
    {
      provide: GATEWAY_CONFIG,
      useFactory: () => loadGatewayConfig(process.env),
    },
  ],
  exports: [GATEWAY_CONFIG],
})
export class GatewayConfigModule {}
