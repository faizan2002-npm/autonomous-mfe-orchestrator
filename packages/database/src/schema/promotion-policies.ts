import { sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';
import { consumers } from './consumers.js';
import { serviceRegistries } from './service-registries.js';

/**
 * Rules for promoting or rolling back canary patches without a human. A policy applies to
 * the whole org, one service, one consumer, or one service for one consumer; the most
 * specific enabled policy wins.
 */
export const promotionPolicies = pgTable(
  'promotion_policies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id').references(() => serviceRegistries.id, { onDelete: 'cascade' }),
    consumerId: uuid('consumer_id').references(() => consumers.id, { onDelete: 'cascade' }),
    /** `<serviceId|*>:<consumerId|*>`: one policy per scope (unique NULLs would allow duplicates). */
    scope: varchar('scope', { length: 80 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    minCanaryRequests: integer('min_canary_requests').default(50).notNull(),
    minCanaryMinutes: integer('min_canary_minutes').default(30).notNull(),
    maxFailureRate: doublePrecision('max_failure_rate').default(0).notNull(),
    rollbackFailureRate: doublePrecision('rollback_failure_rate'),
    rollbackMinRequests: integer('rollback_min_requests').default(10).notNull(),
    allowedGenerators: text('allowed_generators')
      .array()
      .default(sql`ARRAY['gemini', 'fallback']::text[]`)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    oneScope: unique('promotion_policies_org_scope_unique').on(table.orgId, table.scope),
  }),
);

export type PromotionPolicy = typeof promotionPolicies.$inferSelect;
export type NewPromotionPolicy = typeof promotionPolicies.$inferInsert;
