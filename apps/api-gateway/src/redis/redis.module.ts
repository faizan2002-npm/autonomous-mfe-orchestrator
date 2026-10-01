import { Module } from '@nestjs/common';
import { RedisService } from './redis.service.js';
import { REDIS_CLIENT } from './redis.tokens.js';

@Module({
  providers: [
    RedisService,
    {
      provide: REDIS_CLIENT,
      inject: [RedisService],
      useFactory: (redis: RedisService) => redis.client,
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
