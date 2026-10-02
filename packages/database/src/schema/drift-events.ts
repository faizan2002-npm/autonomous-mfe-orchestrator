import { DRIFT_TYPES, SEVERITIES } from '@orchestrator/shared-types';
import {
  pgTable,
  uuid,
  doublePrecision,
  jsonb,
  boolean,
  timestamp,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';
import { consumers } from './consumers.js';
import { serviceRegistries } from './service-registries.js';
import { apiContracts } from './api-contracts.js';

export const driftTypeEnum = pgEnum('drift_type', DRIFT_TYPES);

export const severityEnum = pgEnum('severity', SEVERITIES);

export const driftEvents = pgTable('drift_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  consumerId: uuid('consumer_id')
    .notNull()
    .references(() => consumers.id, { onDelete: 'cascade' }),
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
  detectedAt: timestamp('detected_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type DriftEvent = typeof driftEvents.$inferSelect;
export type NewDriftEvent = typeof driftEvents.$inferInsert;
