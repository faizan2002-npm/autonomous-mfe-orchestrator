import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  notificationDeliveries,
  notificationEndpoints,
  pushSubscriptions,
  type DrizzleDb,
  type NotificationDelivery,
} from '@orchestrator/database';
import { eq, inArray, sql } from 'drizzle-orm';
import { GATEWAY_CONFIG, type GatewayConfig } from '../config/gateway-config.js';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import { ServiceRegistryService } from '../services/service-registry.service.js';
import { NotificationsService } from './notifications.service.js';
import {
  createEmailSender,
  createPushSender,
  PushGoneError,
  type EmailMessage,
  type EmailSender,
  type PushSender,
} from './senders.js';
import { signWebhook } from './webhook-signature.js';

const POLL_MS = 2_000;
const BATCH = 25;
const MAX_ATTEMPTS = 6;
const LOCK_SECONDS = 60;

/** 30 s, 1 min, 2 min, 4 min, 8 min, then give up. */
export const backoffMs = (attempt: number) => Math.min(30_000 * 2 ** (attempt - 1), 3_600_000);

class PermanentFailure extends Error {}

/**
 * Sends queued deliveries. Rows are claimed with FOR UPDATE SKIP LOCKED, so any number of
 * gateway instances can run the worker without sending anything twice.
 */
@Injectable()
export class OutboxWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxWorker.name);
  readonly email: EmailSender;
  readonly push: PushSender;
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    @Inject(GATEWAY_CONFIG) config: GatewayConfig,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(ServiceRegistryService) private readonly services: ServiceRegistryService,
  ) {
    this.email = createEmailSender(config.email);
    this.push = createPushSender(config.push);
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      if (!this.running)
        this.running = this.drain()
          .then(() => undefined)
          .catch((error: unknown) => this.logger.error(`Outbox run failed: ${String(error)}`))
          .finally(() => (this.running = undefined));
    }, POLL_MS);
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }

  /** Sends everything currently due. Returns how many deliveries were attempted. */
  async drain(): Promise<number> {
    let total = 0;
    for (;;) {
      const batch = await this.claim();
      if (!batch.length) return total;
      total += batch.length;
      await Promise.all(batch.map((delivery) => this.deliver(delivery)));
    }
  }

  private async claim(): Promise<NotificationDelivery[]> {
    const claimed = await this.db.execute<{ id: string }>(sql`
      update notification_deliveries
         set status = 'sending', attempts = attempts + 1,
             locked_until = now() + make_interval(secs => ${LOCK_SECONDS})
       where id in (
         select id from notification_deliveries
          where (status = 'pending' and next_attempt_at <= now())
             or (status = 'sending' and locked_until < now())
          order by next_attempt_at
          limit ${BATCH}
          for update skip locked)
      returning id`);
    const ids = [...claimed].map((row) => row.id);
    if (!ids.length) return [];
    return this.db.select().from(notificationDeliveries).where(inArray(notificationDeliveries.id, ids));
  }

  private async deliver(delivery: NotificationDelivery): Promise<void> {
    try {
      await this.send(delivery);
      await this.db
        .update(notificationDeliveries)
        .set({ status: 'sent', sentAt: new Date(), lastError: null, lockedUntil: null })
        .where(eq(notificationDeliveries.id, delivery.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const dead = error instanceof PermanentFailure || error instanceof PushGoneError || delivery.attempts >= MAX_ATTEMPTS;
      await this.db
        .update(notificationDeliveries)
        .set({
          status: dead ? 'dead' : 'pending',
          lastError: message.slice(0, 1_000),
          lockedUntil: null,
          nextAttemptAt: new Date(Date.now() + backoffMs(delivery.attempts)),
        })
        .where(eq(notificationDeliveries.id, delivery.id));
      if (dead) {
        this.logger.warn('Notification delivery gave up after max attempts', {
          deliveryId: delivery.id,
          channel: delivery.channel,
          event: delivery.event,
          orgId: delivery.orgId,
          endpointId: delivery.endpointId,
          attempts: delivery.attempts,
          error: message,
        });
      }
    }
  }

  private async send(delivery: NotificationDelivery): Promise<void> {
    const payload = delivery.payload as Record<string, unknown>;
    switch (delivery.channel) {
      case 'email':
        return this.email.send(payload as unknown as EmailMessage);
      case 'push':
        return this.sendPush(payload);
      case 'slack':
      case 'webhook':
        return this.sendToEndpoint(delivery, payload);
    }
  }

  private async sendPush(payload: Record<string, unknown>): Promise<void> {
    if (!this.push.enabled) throw new PermanentFailure('Web push is not configured');
    const [subscription] = await this.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.id, String(payload.subscriptionId)));
    if (!subscription) throw new PermanentFailure('Subscription was removed');
    try {
      await this.push.send(subscription, { title: payload.title, body: payload.body, url: payload.url });
    } catch (error) {
      if (error instanceof PushGoneError)
        await this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id));
      throw error;
    }
  }

  private async sendToEndpoint(delivery: NotificationDelivery, payload: Record<string, unknown>): Promise<void> {
    if (!delivery.endpointId) throw new PermanentFailure('Endpoint missing');
    const [endpoint] = await this.db
      .select()
      .from(notificationEndpoints)
      .where(eq(notificationEndpoints.id, delivery.endpointId));
    if (!endpoint) throw new PermanentFailure('Endpoint was deleted');
    const { url, signingSecret } = this.notifications.endpointSecrets(endpoint);
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { 'content-type': 'application/json', 'user-agent': 'MFE-Orchestrator-Webhooks/1' };
    if (endpoint.type === 'webhook' && signingSecret) {
      headers['x-orchestrator-signature'] = signWebhook(body, signingSecret);
      headers['x-orchestrator-event'] = delivery.event;
      headers['x-orchestrator-delivery'] = delivery.id;
    }
    // Add W3C Trace Context if available in payload (for distributed tracing)
    if (typeof payload.traceparent === 'string') {
      headers['traceparent'] = payload.traceparent;
    }
    // Same SSRF protection as proxied traffic: org-supplied URLs never reach internal hosts.
    const response = await this.services.guardedFetch(url, {
      method: 'POST',
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status >= 200 && response.status < 300) return;
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429)
      throw new PermanentFailure(`Endpoint rejected the delivery (${response.status}) ${detail}`.trim());
    throw new Error(`Endpoint responded ${response.status} ${detail}`.trim());
  }
}
