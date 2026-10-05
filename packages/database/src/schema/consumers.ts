import { CONSUMER_KINDS, KEY_TYPES } from '@orchestrator/shared-types';
import {
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';
import { serviceRegistries } from './service-registries.js';

export const consumerKindEnum = pgEnum('consumer_kind', CONSUMER_KINDS);
export const keyTypeEnum = pgEnum('key_type', KEY_TYPES);

/** An application calling services through the gateway: a frontend or a backend. */
export const consumers = pgTable(
  'consumers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 128 }).notNull(),
    kind: consumerKindEnum('kind').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    orgNameIdx: uniqueIndex('consumers_org_name_idx').on(
      table.orgId,
      table.name,
    ),
  }),
);

export const consumerKeys = pgTable('consumer_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  consumerId: uuid('consumer_id')
    .notNull()
    .references(() => consumers.id, { onDelete: 'cascade' }),
  type: keyTypeEnum('type').notNull(),
  /** First characters of the key, shown in the UI to tell keys apart. */
  prefix: varchar('prefix', { length: 24 }).notNull(),
  /** HMAC-SHA256 of the full key with the server pepper. */
  keyHash: varchar('key_hash', { length: 64 }).notNull().unique(),
  /** Publishable keys only work from these browser origins. */
  allowedOrigins: jsonb('allowed_origins')
    .$type<string[]>()
    .default([])
    .notNull(),
  createdBy: varchar('created_by', { length: 320 }).notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** Which services a consumer may call. */
export const consumerServices = pgTable(
  'consumer_services',
  {
    consumerId: uuid('consumer_id')
      .notNull()
      .references(() => consumers.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => serviceRegistries.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.consumerId, table.serviceId] }),
  }),
);

export type Consumer = typeof consumers.$inferSelect;
export type ConsumerKey = typeof consumerKeys.$inferSelect;
