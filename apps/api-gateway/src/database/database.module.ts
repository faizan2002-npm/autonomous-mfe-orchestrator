import { Module, Global } from '@nestjs/common';
import { createDatabaseClient, type DrizzleDb } from '@orchestrator/database';
import { Redis } from 'ioredis';

export const DRIZZLE_DB = 'DRIZZLE_DB';
export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE_DB,
      useFactory: (): DrizzleDb => {
        return createDatabaseClient(process.env.DATABASE_URL);
      },
    },
    {
      provide: REDIS_CLIENT,
      useFactory: (): Redis => {
        const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
        return new Redis(redisUrl, {
          maxRetriesPerRequest: 3,
          retryStrategy(times: number) {
            return Math.min(times * 100, 3000);
          },
          lazyConnect: true,
        });
      },
    },
  ],
  exports: [DRIZZLE_DB, REDIS_CLIENT],
})
export class DatabaseModule {}
