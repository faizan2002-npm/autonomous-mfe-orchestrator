import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { decryptSecret, encryptSecret, randomToken } from '@orchestrator/crypto';
import {
  notificationDeliveries,
  notificationEndpoints,
  notificationPreferences,
  notifications,
  orgMembers,
  organizations,
  pushSubscriptions,
  type DrizzleDb,
  type NotificationDelivery,
  type NotificationEndpoint,
  type NotificationRow,
} from '@orchestrator/database';
import {
  NOTIFICATION_EVENTS,
  type CreatedEndpoint,
  type DeliveryView,
  type GatewayEvent,
  type Inbox,
  type NotificationChannel,
  type NotificationEndpointView,
  type NotificationEvent,
  type NotificationPreferences,
  type NotificationView,
  type OrgRole,
} from '@orchestrator/shared-types';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { roleAtLeast, type OrgAccess } from '../auth/org.guard.js';
import type { AuthenticatedUser } from '../auth/token-verifier.js';
import { assertSafeUrl, UnsafeUrlError } from '../common/ssrf-guard.js';
import { GATEWAY_CONFIG, type GatewayConfig } from '../config/gateway-config.js';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import { GatewayEventsService } from '../events/gateway-events.service.js';
import { ActivityService } from '../orgs/activity.service.js';
import { defaultChannels, toMessage, type NotificationMessage } from './messages.js';
import type { CreateEndpointDto, UpdateEndpointDto } from './notifications.dto.js';
import { invitationEmail, notificationEmail } from './templates.js';

type DeliveryInsert = typeof notificationDeliveries.$inferInsert;

/**
 * Turns pipeline events into notifications: an inbox row per recipient, plus outbox
 * deliveries (email, push, Slack, webhooks) that the OutboxWorker sends with retries.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
    @Inject(GatewayEventsService) private readonly events: GatewayEventsService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {
    this.events.localStream().subscribe((event) => {
      void this.handle(event).catch((error: unknown) =>
        this.logger.error(`Notification fan-out failed for ${event.type}: ${String(error)}`),
      );
    });
  }

  /** Exposed for tests; normally driven by the event stream. */
  async handle(event: GatewayEvent): Promise<void> {
    if (event.type === 'member.invited') return this.queueInvitation(event);
    const message = toMessage(event);
    if (message) await this.fanOut(event, message);
  }

  private async fanOut(event: GatewayEvent, message: NotificationMessage): Promise<void> {
    const [org] = await this.db.select().from(organizations).where(eq(organizations.id, event.orgId));
    if (!org) return;
    const members = (await this.db.select().from(orgMembers).where(eq(orgMembers.orgId, org.id))).filter(
      (member) => message.audience === 'members' || roleAtLeast(member.role, 'reviewer'),
    );
    const url = `${this.config.appUrl}/o/${org.slug}${message.path}`;
    const settingsUrl = `${this.config.appUrl}/o/${org.slug}/notifications`;
    const deliveries: DeliveryInsert[] = [];

    if (members.length) {
      const inbox = await this.db
        .insert(notifications)
        .values(
          members.map((member) => ({
            orgId: org.id,
            userId: member.userId,
            event: message.event,
            title: message.title,
            body: message.body,
            link: `/o/${org.slug}${message.path}`,
          })),
        )
        .returning({ id: notifications.id, userId: notifications.userId });
      for (const row of inbox)
        this.events.publish({
          type: 'notification.created',
          orgId: org.id,
          userId: row.userId,
          notificationId: row.id,
          title: message.title,
        });

      const channels = await this.channelsFor(org.id, members, message.event);
      const subscriptions = await this.subscriptionsFor(
        members.filter((m) => channels.get(m.userId)?.includes('push')).map((m) => m.userId),
      );
      for (const member of members) {
        const wanted = channels.get(member.userId) ?? [];
        if (wanted.includes('email'))
          deliveries.push({
            orgId: org.id,
            channel: 'email',
            event: message.event,
            target: member.email,
            payload: {
              to: member.email,
              ...notificationEmail({ orgName: org.name, title: message.title, body: message.body, url, settingsUrl }),
            },
          });
        if (wanted.includes('push') && this.config.push)
          for (const subscription of subscriptions.filter((s) => s.userId === member.userId))
            deliveries.push({
              orgId: org.id,
              channel: 'push',
              event: message.event,
              target: subscription.id,
              payload: { subscriptionId: subscription.id, title: message.title, body: message.body, url },
            });
      }
    }

    const endpoints = await this.db
      .select()
      .from(notificationEndpoints)
      .where(and(eq(notificationEndpoints.orgId, org.id), eq(notificationEndpoints.enabled, true)));
    for (const endpoint of endpoints.filter((e) => e.events.includes(message.event)))
      deliveries.push(this.endpointDelivery(endpoint, message.event, { org: org.name, message, url, event }));

    if (deliveries.length) await this.db.insert(notificationDeliveries).values(deliveries);
  }

  private endpointDelivery(
    endpoint: NotificationEndpoint,
    event: NotificationEvent | 'test',
    content: { org: string; message: Pick<NotificationMessage, 'title' | 'body'>; url: string; event?: GatewayEvent },
  ): DeliveryInsert {
    const payload =
      endpoint.type === 'slack'
        ? {
            text: `${content.message.title}: ${content.message.body}`,
            blocks: [
              { type: 'header', text: { type: 'plain_text', text: content.message.title.slice(0, 150) } },
              { type: 'section', text: { type: 'mrkdwn', text: content.message.body.slice(0, 2_900) } },
              {
                type: 'actions',
                elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open in dashboard' }, url: content.url }],
              },
              { type: 'context', elements: [{ type: 'mrkdwn', text: `MFE Orchestrator · ${content.org}` }] },
            ],
          }
        : {
            id: randomToken(),
            type: event,
            createdAt: new Date().toISOString(),
            organization: content.org,
            title: content.message.title,
            body: content.message.body,
            url: content.url,
            data: content.event ?? null,
          };
    return {
      orgId: endpoint.orgId,
      channel: endpoint.type,
      event,
      target: endpoint.name,
      endpointId: endpoint.id,
      payload,
    };
  }

  private async queueInvitation(event: Extract<GatewayEvent, { type: 'member.invited' }>): Promise<void> {
    await this.db.insert(notificationDeliveries).values({
      orgId: event.orgId,
      channel: 'email',
      event: 'member.invited',
      target: event.email,
      payload: {
        to: event.email,
        ...invitationEmail({
          orgName: event.orgName,
          role: event.role,
          invitedBy: event.invitedBy,
          acceptUrl: event.acceptUrl,
        }),
      },
    });
  }

  private async channelsFor(
    orgId: string,
    members: Array<{ userId: string; role: OrgRole }>,
    event: NotificationEvent,
  ): Promise<Map<string, NotificationChannel[]>> {
    const rows = await this.db
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.orgId, orgId),
          eq(notificationPreferences.event, event),
          inArray(notificationPreferences.userId, members.map((m) => m.userId)),
        ),
      );
    return new Map(
      members.map((member) => [
        member.userId,
        (rows.find((row) => row.userId === member.userId)?.channels as NotificationChannel[] | undefined) ??
          defaultChannels(member.role, event),
      ]),
    );
  }

  private subscriptionsFor(userIds: string[]) {
    if (!userIds.length) return Promise.resolve([]);
    return this.db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, userIds));
  }

  // ---- Inbox --------------------------------------------------------------------------------

  async inbox(orgId: string, userId: string, limit: number): Promise<Inbox> {
    const [rows, [{ unread }]] = await Promise.all([
      this.db
        .select()
        .from(notifications)
        .where(and(eq(notifications.orgId, orgId), eq(notifications.userId, userId)))
        .orderBy(desc(notifications.createdAt))
        .limit(limit),
      this.db
        .select({ unread: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(eq(notifications.orgId, orgId), eq(notifications.userId, userId), isNull(notifications.readAt))),
    ]);
    return { items: rows.map(toNotificationView), unreadCount: unread };
  }

  async markRead(orgId: string, userId: string, ids?: string[]): Promise<void> {
    const conditions = [eq(notifications.orgId, orgId), eq(notifications.userId, userId), isNull(notifications.readAt)];
    if (ids?.length) conditions.push(inArray(notifications.id, ids));
    await this.db.update(notifications).set({ readAt: new Date() }).where(and(...conditions));
  }

  // ---- Preferences --------------------------------------------------------------------------

  async preferences(org: OrgAccess, userId: string): Promise<NotificationPreferences> {
    const rows = await this.db
      .select()
      .from(notificationPreferences)
      .where(and(eq(notificationPreferences.orgId, org.id), eq(notificationPreferences.userId, userId)));
    return Object.fromEntries(
      NOTIFICATION_EVENTS.map((event) => [
        event,
        (rows.find((row) => row.event === event)?.channels as NotificationChannel[] | undefined) ??
          defaultChannels(org.role, event),
      ]),
    ) as NotificationPreferences;
  }

  async updatePreferences(
    org: OrgAccess,
    userId: string,
    preferences: Partial<NotificationPreferences>,
  ): Promise<NotificationPreferences> {
    for (const [event, channels] of Object.entries(preferences) as Array<[NotificationEvent, NotificationChannel[]]>)
      await this.db
        .insert(notificationPreferences)
        .values({ orgId: org.id, userId, event, channels: [...new Set(channels)] })
        .onConflictDoUpdate({
          target: [notificationPreferences.orgId, notificationPreferences.userId, notificationPreferences.event],
          set: { channels: [...new Set(channels)] },
        });
    return this.preferences(org, userId);
  }

  // ---- Push subscriptions -------------------------------------------------------------------

  async subscribePush(
    user: AuthenticatedUser,
    subscription: { endpoint: string; p256dh: string; auth: string },
    userAgent?: string,
  ): Promise<void> {
    if (!this.config.push) throw new BadRequestException('Web push is not configured on this gateway');
    await this.db
      .insert(pushSubscriptions)
      .values({ userId: user.id, ...subscription, userAgent: userAgent?.slice(0, 512) })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId: user.id, p256dh: subscription.p256dh, auth: subscription.auth },
      });
  }

  async unsubscribePush(user: AuthenticatedUser, endpoint: string): Promise<void> {
    await this.db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, user.id), eq(pushSubscriptions.endpoint, endpoint)));
  }

  // ---- Org endpoints (Slack, webhooks) ------------------------------------------------------

  async listEndpoints(orgId: string): Promise<NotificationEndpointView[]> {
    const rows = await this.db
      .select()
      .from(notificationEndpoints)
      .where(eq(notificationEndpoints.orgId, orgId))
      .orderBy(notificationEndpoints.createdAt);
    return rows.map(toEndpointView);
  }

  async createEndpoint(org: OrgAccess, dto: CreateEndpointDto, user: AuthenticatedUser): Promise<CreatedEndpoint> {
    const url = await this.safeUrl(dto.url, dto.type);
    const signingSecret = dto.type === 'webhook' ? `whsec_${randomToken()}` : null;
    const [row] = await this.db
      .insert(notificationEndpoints)
      .values({
        orgId: org.id,
        type: dto.type,
        name: dto.name,
        urlEnc: encryptSecret(url.toString(), this.config.encryptionKey),
        urlHost: url.host,
        signingSecretEnc: signingSecret ? encryptSecret(signingSecret, this.config.encryptionKey) : null,
        events: [...new Set(dto.events)],
      })
      .returning();
    await this.activity.record(org.id, {
      actor: user.email ?? user.id,
      action: 'notification_endpoint.created',
      targetType: dto.type,
      targetId: dto.name,
      details: { host: url.host, events: dto.events },
    });
    return { ...toEndpointView(row), signingSecret };
  }

  async updateEndpoint(org: OrgAccess, id: string, dto: UpdateEndpointDto, user: AuthenticatedUser) {
    const existing = await this.endpoint(org.id, id);
    const changes: Partial<typeof notificationEndpoints.$inferInsert> = {};
    if (dto.name !== undefined) changes.name = dto.name;
    if (dto.events !== undefined) changes.events = [...new Set(dto.events)];
    if (dto.enabled !== undefined) changes.enabled = dto.enabled;
    if (dto.url !== undefined) {
      const url = await this.safeUrl(dto.url, existing.type);
      changes.urlEnc = encryptSecret(url.toString(), this.config.encryptionKey);
      changes.urlHost = url.host;
    }
    const [row] = await this.db
      .update(notificationEndpoints)
      .set(changes)
      .where(eq(notificationEndpoints.id, id))
      .returning();
    await this.activity.record(org.id, {
      actor: user.email ?? user.id,
      action: 'notification_endpoint.updated',
      targetType: existing.type,
      targetId: existing.name,
      details: { changed: Object.keys(dto) },
    });
    return toEndpointView(row);
  }

  async deleteEndpoint(org: OrgAccess, id: string, user: AuthenticatedUser): Promise<void> {
    const existing = await this.endpoint(org.id, id);
    await this.db.delete(notificationEndpoints).where(eq(notificationEndpoints.id, id));
    await this.activity.record(org.id, {
      actor: user.email ?? user.id,
      action: 'notification_endpoint.deleted',
      targetType: existing.type,
      targetId: existing.name,
    });
  }

  async testEndpoint(org: OrgAccess, id: string): Promise<void> {
    const endpoint = await this.endpoint(org.id, id);
    await this.db.insert(notificationDeliveries).values(
      this.endpointDelivery(endpoint, 'test', {
        org: org.name,
        message: { title: 'Test notification', body: `If you can read this, ${endpoint.name} is connected.` },
        url: `${this.config.appUrl}/o/${org.slug}/notifications`,
      }),
    );
  }

  /** Sends the signed-in member a test email and push on every device. */
  async testPersonal(org: OrgAccess, user: AuthenticatedUser): Promise<{ email: boolean; pushDevices: number }> {
    const url = `${this.config.appUrl}/o/${org.slug}/notifications`;
    const deliveries: DeliveryInsert[] = [];
    if (user.email)
      deliveries.push({
        orgId: org.id,
        channel: 'email',
        event: 'test',
        target: user.email,
        payload: {
          to: user.email,
          ...notificationEmail({
            orgName: org.name,
            title: 'Test notification',
            body: 'Email notifications are working.',
            url,
            settingsUrl: url,
          }),
        },
      });
    const subscriptions = this.config.push ? await this.subscriptionsFor([user.id]) : [];
    for (const subscription of subscriptions)
      deliveries.push({
        orgId: org.id,
        channel: 'push',
        event: 'test',
        target: subscription.id,
        payload: { subscriptionId: subscription.id, title: 'Test notification', body: 'Push notifications are working.', url },
      });
    if (deliveries.length) await this.db.insert(notificationDeliveries).values(deliveries);
    return { email: Boolean(user.email), pushDevices: subscriptions.length };
  }

  async deliveries(orgId: string, endpointId?: string, limit = 50): Promise<DeliveryView[]> {
    const conditions = [eq(notificationDeliveries.orgId, orgId)];
    if (endpointId) conditions.push(eq(notificationDeliveries.endpointId, endpointId));
    const rows = await this.db
      .select()
      .from(notificationDeliveries)
      .where(and(...conditions))
      .orderBy(desc(notificationDeliveries.createdAt))
      .limit(limit);
    return rows.map(toDeliveryView);
  }

  async redeliver(orgId: string, deliveryId: string): Promise<void> {
    const [row] = await this.db
      .update(notificationDeliveries)
      .set({ status: 'pending', attempts: 0, nextAttemptAt: new Date(), lastError: null, lockedUntil: null })
      .where(and(eq(notificationDeliveries.id, deliveryId), eq(notificationDeliveries.orgId, orgId)))
      .returning();
    if (!row) throw new NotFoundException('Delivery not found');
  }

  /** Decrypted target of an endpoint delivery, for the worker. */
  endpointSecrets(endpoint: NotificationEndpoint): { url: string; signingSecret: string | null } {
    return {
      url: decryptSecret(endpoint.urlEnc, this.config.encryptionKey),
      signingSecret: endpoint.signingSecretEnc
        ? decryptSecret(endpoint.signingSecretEnc, this.config.encryptionKey)
        : null,
    };
  }

  private async endpoint(orgId: string, id: string): Promise<NotificationEndpoint> {
    const [row] = await this.db
      .select()
      .from(notificationEndpoints)
      .where(and(eq(notificationEndpoints.id, id), eq(notificationEndpoints.orgId, orgId)))
      .limit(1);
    if (!row) throw new NotFoundException('Endpoint not found');
    return row;
  }

  private async safeUrl(raw: string, type: 'slack' | 'webhook'): Promise<URL> {
    try {
      const url = await assertSafeUrl(raw, this.config.allowPrivateUpstreams);
      if (type === 'slack' && url.hostname !== 'hooks.slack.com' && !this.config.allowPrivateUpstreams)
        throw new UnsafeUrlError('Slack endpoints must be https://hooks.slack.com incoming webhooks');
      return url;
    } catch (error) {
      if (error instanceof UnsafeUrlError) throw new BadRequestException(`url: ${error.message}`);
      throw error;
    }
  }
}

function toNotificationView(row: NotificationRow): NotificationView {
  return {
    id: row.id,
    event: row.event as NotificationEvent,
    title: row.title,
    body: row.body,
    link: row.link,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toEndpointView(row: NotificationEndpoint): NotificationEndpointView {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    urlHost: row.urlHost,
    events: row.events as NotificationEvent[],
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDeliveryView(row: NotificationDelivery): DeliveryView {
  return {
    id: row.id,
    channel: row.channel,
    event: row.event as DeliveryView['event'],
    target: row.channel === 'push' ? 'browser' : row.target,
    status: row.status,
    attempts: row.attempts,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
  };
}
