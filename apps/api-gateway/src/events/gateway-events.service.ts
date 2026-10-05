import { Injectable } from '@nestjs/common';
import type { GatewayEvent } from '@orchestrator/shared-types';
import { Observable, Subject } from 'rxjs';

/** Distributive Omit so each event variant keeps its own fields. */
export type GatewayEventInput = GatewayEvent extends infer E
  ? E extends GatewayEvent
    ? Omit<E, 'at'>
    : never
  : never;

/** In-process pub/sub for pipeline events streamed to the dashboard. */
@Injectable()
export class GatewayEventsService {
  private readonly events = new Subject<GatewayEvent>();

  publish(event: GatewayEventInput): void {
    this.events.next({
      ...event,
      at: new Date().toISOString(),
    } as GatewayEvent);
  }

  stream(): Observable<GatewayEvent> {
    return this.events.asObservable();
  }
}
