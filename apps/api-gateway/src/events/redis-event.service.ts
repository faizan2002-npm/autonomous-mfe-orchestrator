import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
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
  /** Marks this instance's messages, which it already delivered locally. */
  private readonly instanceId = randomUUID();

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationBootstrap(): Promise<void> {
    // Create a separate connection for subscriptions (blocking mode)
    this.subscriber = this.redis.duplicate();
    try {
      await this.subscriber.subscribe(this.channel);
      this.subscriber.on('message', (ch, msg) => {
        if (ch !== this.channel) return;
        try {
          const { origin, event } = JSON.parse(msg) as {
            origin: string;
            event: GatewayEvent;
          };
          if (origin !== this.instanceId) this.events.next(event);
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

  /** Publishes event to Redis pub/sub for the other instances. */
  publish(event: GatewayEvent): void {
    const json = JSON.stringify({ origin: this.instanceId, event });
    this.redis
      .publish(this.channel, json)
      .catch((error: Error) =>
        this.logger.error(`Failed to publish event: ${error.message}`),
      );
  }

  /** Events published by the other instances. */
  stream() {
    return this.events.asObservable();
  }
}
