import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';
import { serviceRegistries } from './service-registries.js';

/**
 * Response contracts declared by a service's imported OpenAPI document. A consumer's first
 * request to a matching endpoint starts from this baseline instead of learning from traffic.
 */
export const serviceOperations = pgTable(
  'service_operations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => serviceRegistries.id, { onDelete: 'cascade' }),
    httpMethod: varchar('http_method', { length: 16 }).notNull(),
    /** Full path template as the upstream receives it, e.g. /api/v1/users/{id}. */
    pathTemplate: varchar('path_template', { length: 512 }).notNull(),
    operationId: varchar('operation_id', { length: 255 }),
    summary: text('summary'),
    responseStatus: varchar('response_status', { length: 8 }).notNull(),
    schemaTokens: jsonb('schema_tokens').$type<string[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    serviceOperationIdx: uniqueIndex('service_operations_service_method_path_idx').on(
      table.serviceId,
      table.httpMethod,
      table.pathTemplate,
    ),
  }),
);

/** Summary of the last OpenAPI import, stored on the service. */
export interface OpenApiImportInfo {
  title: string;
  version: string;
  importedAt: string;
  importedBy: string;
  operations: number;
  skipped: string[];
  requiredOnly: boolean;
  sourceUrl: string | null;
}

export type ServiceOperation = typeof serviceOperations.$inferSelect;
