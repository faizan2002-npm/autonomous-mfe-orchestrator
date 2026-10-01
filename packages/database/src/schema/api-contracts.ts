import { pgTable, uuid, varchar, jsonb, integer, boolean, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { serviceRegistries } from './service-registries.js';

export const apiContracts = pgTable(
  'api_contracts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => serviceRegistries.id, { onDelete: 'cascade' }),
    endpointPath: varchar('endpoint_path', { length: 512 }).notNull(),
    httpMethod: varchar('http_method', { length: 16 }).notNull(),
    schemaSnapshot: jsonb('schema_snapshot').notNull(),
    fieldCount: integer('field_count').notNull(),
    version: integer('version').default(1).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    serviceEndpointMethodVersionIdx: uniqueIndex('contract_service_endpoint_method_ver_idx').on(
      table.serviceId,
      table.endpointPath,
      table.httpMethod,
      table.version
    ),
  })
);

export type ApiContract = typeof apiContracts.$inferSelect;
export type NewApiContract = typeof apiContracts.$inferInsert;
