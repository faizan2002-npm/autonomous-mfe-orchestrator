import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { ConsumerAuthService } from './consumer-auth.service.js';
import { ConsumersController } from './consumers.controller.js';
import { ConsumersService } from './consumers.service.js';

/** Applications that call services through the gateway, and their API keys. */
@Global()
@Module({
  imports: [DatabaseModule, RedisModule],
  controllers: [ConsumersController],
  providers: [ConsumersService, ConsumerAuthService],
  exports: [ConsumersService, ConsumerAuthService],
})
export class ConsumersModule {}
