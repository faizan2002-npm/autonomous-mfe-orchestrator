import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import {
  GATEWAY_CONFIG,
  type GatewayConfig,
} from '../config/gateway-config.js';

@Injectable()
export class RedisService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(@Inject(GATEWAY_CONFIG) config: GatewayConfig) {
    this.client = new Redis(config.redisUrl, {
      lazyConnect: true,
      connectTimeout: 5_000,
      commandTimeout: 5_000,
      maxRetriesPerRequest: 3,
      retryStrategy: (attempt) => Math.min(attempt * 100, 3_000),
    });
    this.client.on('error', (error: Error) => this.logger.error(error.message));
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
      await this.client.ping();
    } catch (error) {
      this.client.disconnect();
      throw error;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.client.status === 'end') return;
    const closed = new Promise<void>((resolve) =>
      this.client.once('end', resolve),
    );
    try {
      if (this.client.status === 'ready') await this.client.quit();
    } finally {
      this.client.disconnect();
      await closed;
    }
  }
}
