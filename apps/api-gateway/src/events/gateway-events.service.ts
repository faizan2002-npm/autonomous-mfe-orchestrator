import {
  Injectable,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { GatewayEvent } from '@orchestrator/shared-types';
import { Observable, Subject, merge } from 'rxjs';
import { RedisEventService } from './redis-event.service.js';

/** Distributive Omit so each event variant keeps its own fields. */
export type GatewayEventInput = GatewayEvent extends infer E
  ? E extends GatewayEvent
    ? Omit<E, 'at'>
    : never
  : never;

/**
 * Multi-instance event bus.
 * - Publishes to Redis pub/sub (distributed across instances)
 * - Streams events from all instances to local SSE clients
 * - Local Subject caches events for SSE clients connected to this instance
 */
@Injectable()
export class GatewayEventsService implements OnApplicationBootstrap {
  private readonly localEvents = new Subject<GatewayEvent>();
  private readonly mergedStream: Observable<GatewayEvent>;

  constructor(private readonly redisEvents: RedisEventService) {
    // Built eagerly because other providers subscribe in their constructors; merge is lazy,
    // so nothing flows until the first subscription.
    this.mergedStream = merge(
      this.localEvents.asObservable(),
      this.redisEvents.stream(),
    );
  }

  onApplicationBootstrap(): void {
    // Subscribe to ensure side effects happen
    this.mergedStream.subscribe();
  }

  publish(event: GatewayEventInput): void {
    const fullEvent = {
      ...event,
      at: new Date().toISOString(),
    } as GatewayEvent;

    // Publish to Redis (all instances will receive it)
    this.redisEvents.publish(fullEvent);

    // Also emit locally (for immediate local SSE clients, plus mergedStream subscribers)
    this.localEvents.next(fullEvent);
  }

  /** Returns observable of events from all instances (merged Redis + local). */
  stream(): Observable<GatewayEvent> {
    return this.mergedStream;
  }
}
