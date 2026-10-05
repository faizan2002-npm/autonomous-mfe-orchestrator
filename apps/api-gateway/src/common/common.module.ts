import { Global, Module, Inject, Optional } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { CircuitBreakerService } from './circuit-breaker.service.js';
import { RedisModule } from '../redis/redis.module.js';
import { REDIS_CLIENT } from '../redis/redis.tokens.js';

@Global()
@Module({
  imports: [RedisModule],
  providers: [
    {
      provide: CircuitBreakerService,
      inject: [REDIS_CLIENT],
      useFactory: (redis: Redis) => new CircuitBreakerService(redis),
    },
  ],
  exports: [CircuitBreakerService],
})
export class CommonModule {}
