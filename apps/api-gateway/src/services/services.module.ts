import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { ServiceRegistryService } from './service-registry.service.js';
import { ServicesController } from './services.controller.js';

/** Each organization's upstream services; the proxy and demo controls resolve through it. */
@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [ServicesController],
  providers: [ServiceRegistryService],
  exports: [ServiceRegistryService],
})
export class ServicesModule {}
