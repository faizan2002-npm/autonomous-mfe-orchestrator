import { Global, Module } from '@nestjs/common';
import { GatewayEventsService } from './gateway-events.service.js';

@Global()
@Module({
  providers: [GatewayEventsService],
  exports: [GatewayEventsService],
})
export class EventsModule {}
