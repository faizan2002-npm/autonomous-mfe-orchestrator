import { Global, Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module.js';
import { GatewayEventsService } from './gateway-events.service.js';
import { RedisEventService } from './redis-event.service.js';

@Global()
@Module({
  imports: [RedisModule],
  providers: [RedisEventService, GatewayEventsService],
  exports: [GatewayEventsService],
})
export class EventsModule {}
