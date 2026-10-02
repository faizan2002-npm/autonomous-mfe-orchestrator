import { DELIVERY_CHANNELS, DELIVERY_STATUSES, ENDPOINT_TYPES } from '@orchestrator/shared-types';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';

export const endpointTypeEnum = pgEnum('notification_endpoint_type', ENDPOINT_TYPES);
export const deliveryChannelEnum = pgEnum('delivery_channel', DELIVERY_CHANNELS);
export const deliveryStatusEnum = pgEnum('delivery_status', DELIVERY_STATUSES);

/** In-app inbox: one row per recipient. */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    event: varchar('event', { length: 64 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    body: text('body').notNull(),
    link: varchar('link', { length: 512 }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    inboxIdx: index('notifications_inbox_idx').on(table.orgId, table.userId, table.createdAt),
  }),
);

/** A member's channel choices per event; absent rows fall back to role-based defaults. */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    event: varchar('event', { length: 64 }).notNull(),
    channels: jsonb('channels').$type<string[]>().notNull(),
  },
  (table) => ({ pk: primaryKey({ columns: [table.orgId, table.userId, table.event] }) }),
);

/** Organization-wide Slack and webhook integrations. Secrets are AES-256-GCM encrypted. */
export const notificationEndpoints = pgTable('notification_endpoints', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  type: endpointTypeEnum('type').notNull(),
  name: varchar('name', { length: 128 }).notNull(),
  urlEnc: text('url_enc').notNull(),
  urlHost: varchar('url_host', { length: 255 }).notNull(),
  signingSecretEnc: text('signing_secret_enc'),
  events: jsonb('events').$type<string[]>().notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/** Browser push subscriptions; belong to a user across organizations. */
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull(),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: varchar('p256dh', { length: 255 }).notNull(),
  auth: varchar('auth', { length: 255 }).notNull(),
  userAgent: varchar('user_agent', { length: 512 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/** Durable outbox: every email, push, Slack and webhook delivery with retry state. */
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    channel: deliveryChannelEnum('channel').notNull(),
    event: varchar('event', { length: 64 }).notNull(),
    /** Email address, push subscription id or endpoint id. */
    target: varchar('target', { length: 512 }).notNull(),
    endpointId: uuid('endpoint_id').references(() => notificationEndpoints.id, { onDelete: 'cascade' }),
    payload: jsonb('payload').notNull(),
    status: deliveryStatusEnum('status').default('pending').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow().notNull(),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (table) => ({
    dueIdx: index('notification_deliveries_due_idx').on(table.status, table.nextAttemptAt),
  }),
);

export type NotificationRow = typeof notifications.$inferSelect;
export type NotificationEndpoint = typeof notificationEndpoints.$inferSelect;
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type NotificationDelivery = typeof notificationDeliveries.$inferSelect;
