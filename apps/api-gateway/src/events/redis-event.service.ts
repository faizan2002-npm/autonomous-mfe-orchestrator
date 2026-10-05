import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { GatewayEvent } from '@orchestrator/shared-types';
import { REDIS_CLIENT } from '../redis/redis.tokens.js';
import { Subject } from 'rxjs';

/**
 * Redis pub/sub wrapper for multi-instance event distribution.
 * Publishes to Redis channel and subscribes to receive events from all instances.
 */
@Injectable()
export class RedisEventService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(RedisEventService.name);
  private readonly channel = 'gateway:events';
  private subscriber: Redis | null = null;
  private readonly events = new Subject<GatewayEvent>();

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationBootstrap(): Promise<void> {
    // Create a separate connection for subscriptions (blocking mode)
    this.subscriber = this.redis.duplicate();
    try {
      await this.subscriber.subscribe(this.channel);
      this.subscriber.on('message', (ch, msg) => {
        if (ch !== this.channel) return;
        try {
          const event = JSON.parse(msg) as GatewayEvent;
          this.events.next(event);
        } catch (error) {
          this.logger.error(`Failed to parse event: ${error}`);
        }
      });
      this.logger.log(`Subscribed to Redis channel: ${this.channel}`);
    } catch (error) {
      this.subscriber?.disconnect();
      throw error;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.subscriber && this.subscriber.status !== 'end') {
      await this.subscriber.unsubscribe();
      this.subscriber.disconnect();
    }
  }

  /** Publishes event to Redis pub/sub (all instances receive it). */
  publish(event: GatewayEvent): void {
    const json = JSON.stringify(event);
    this.redis
      .publish(this.channel, json)
      .catch((error: Error) =>
        this.logger.error(`Failed to publish event: ${error.message}`),
      );
  }

  /** Returns observable of events received from Redis (from all instances). */
  stream() {
    return this.events.asObservable();
  }
}
