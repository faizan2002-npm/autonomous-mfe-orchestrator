import { pgTable, uuid, doublePrecision, jsonb, boolean, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { serviceRegistries } from './service-registries';
import { apiContracts } from './api-contracts';

export const driftTypeEnum = pgEnum('drift_type', [
  'FIELD_RENAMED',
  'FIELD_DELETED',
  'FIELD_ADDED',
  'TYPE_CHANGED',
  'STRUCTURE_MUTATION',
  'MULTI_FIELD_MUTATION',
]);

export const severityEnum = pgEnum('severity', [
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
]);

export const driftEvents = pgTable('drift_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  contractId: uuid('contract_id')
    .notNull()
    .references(() => apiContracts.id, { onDelete: 'cascade' }),
  serviceId: uuid('service_id')
    .notNull()
    .references(() => serviceRegistries.id, { onDelete: 'cascade' }),
  driftType: driftTypeEnum('drift_type').notNull(),
  severity: severityEnum('severity').default('LOW').notNull(),
  driftCoefficient: doublePrecision('drift_coefficient').notNull(),
  observedPayload: jsonb('observed_payload').notNull(),
  diffDetails: jsonb('diff_details').notNull(),
  isBreaking: boolean('is_breaking').notNull(),
  detectedAt: timestamp('detected_at', { withTimezone: true }).defaultNow().notNull(),
});

export type DriftEvent = typeof driftEvents.$inferSelect;
export type NewDriftEvent = typeof driftEvents.$inferInsert;
