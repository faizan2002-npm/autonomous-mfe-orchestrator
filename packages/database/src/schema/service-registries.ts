import { SERVICE_STATUSES } from '@orchestrator/shared-types';
import {
  integer,
  jsonb,
  pgTable,
  text,
  uuid,
  varchar,
  timestamp,
  pgEnum,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';
import type { OpenApiImportInfo } from './service-operations.js';

export const serviceStatusEnum = pgEnum('service_status', SERVICE_STATUSES);

export const serviceRegistries = pgTable(
  'service_registries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    serviceName: varchar('service_name', { length: 255 }).notNull(),
    /** Base URL requests are forwarded to. */
    endpointUrl: varchar('endpoint_url', { length: 512 }).notNull(),
    description: text('description'),
    healthPath: varchar('health_path', { length: 255 }),
    /** JSON object of headers sent upstream (e.g. auth), AES-256-GCM encrypted. */
    upstreamHeadersEnc: text('upstream_headers_enc'),
    timeoutMs: integer('timeout_ms').default(10_000).notNull(),
    /** The last OpenAPI import; its operations are in service_operations. */
    openapi: jsonb('openapi').$type<OpenApiImportInfo>(),
    status: serviceStatusEnum('status').default('HEALTHY').notNull(),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    orgNameIdx: uniqueIndex('service_registries_org_name_idx').on(
      table.orgId,
      table.serviceName,
    ),
  }),
);

export type ServiceRegistry = typeof serviceRegistries.$inferSelect;
export type NewServiceRegistry = typeof serviceRegistries.$inferInsert;
