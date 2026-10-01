import { pgTable, uuid, varchar, timestamp, pgEnum } from 'drizzle-orm/pg-core';

export const serviceStatusEnum = pgEnum('service_status', [
  'HEALTHY',
  'DEGRADED',
  'DRIFTING',
  'FAILING',
]);

export const serviceRegistries = pgTable('service_registries', {
  id: uuid('id').defaultRandom().primaryKey(),
  serviceName: varchar('service_name', { length: 255 }).notNull().unique(),
  serviceType: varchar('service_type', { length: 64 }).notNull(),
  endpointUrl: varchar('endpoint_url', { length: 512 }).notNull(),
  mfeConsumer: varchar('mfe_consumer', { length: 255 }).notNull(),
  status: serviceStatusEnum('status').default('HEALTHY').notNull(),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type ServiceRegistry = typeof serviceRegistries.$inferSelect;
export type NewServiceRegistry = typeof serviceRegistries.$inferInsert;
