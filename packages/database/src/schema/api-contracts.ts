import { CONTRACT_SOURCES } from '@orchestrator/shared-types';
import {
  pgEnum,
  pgTable,
  uuid,
  varchar,
  jsonb,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { consumers } from './consumers.js';
import { organizations } from './organizations.js';
import { serviceRegistries } from './service-registries.js';

export const contractSourceEnum = pgEnum('contract_source', CONTRACT_SOURCES);

/** Fields a consumer depends on: drift is assessed only on `required` (when set), never on `ignored`. */
export interface PinnedFields {
  required: string[];
  ignored: string[];
}

export const apiContracts = pgTable(
  'api_contracts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    consumerId: uuid('consumer_id')
      .notNull()
      .references(() => consumers.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => serviceRegistries.id, { onDelete: 'cascade' }),
    endpointPath: varchar('endpoint_path', { length: 512 }).notNull(),
    httpMethod: varchar('http_method', { length: 16 }).notNull(),
    schemaSnapshot: jsonb('schema_snapshot').notNull(),
    fieldCount: integer('field_count').notNull(),
    version: integer('version').default(1).notNull(),
    source: contractSourceEnum('source').default('traffic').notNull(),
    pinnedFields: jsonb('pinned_fields').$type<PinnedFields>(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    serviceEndpointMethodVersionIdx: uniqueIndex(
      'contract_consumer_endpoint_method_ver_idx',
    ).on(
      table.serviceId,
      table.consumerId,
      table.endpointPath,
      table.httpMethod,
      table.version,
    ),
  }),
);

export type ApiContract = typeof apiContracts.$inferSelect;
export type NewApiContract = typeof apiContracts.$inferInsert;
