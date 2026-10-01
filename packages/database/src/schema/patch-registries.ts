import { pgTable, uuid, text, varchar, doublePrecision, integer, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { apiContracts } from './api-contracts.js';
import { driftEvents } from './drift-events.js';

export const patchStatusEnum = pgEnum('patch_status', [
  'GENERATING',
  'VALIDATED',
  'CANARY',
  'ACTIVE',
  'FAILED',
  'SUPERSEDED',
  'ROLLED_BACK',
]);

export const patchRegistries = pgTable('patch_registries', {
  id: uuid('id').defaultRandom().primaryKey(),
  contractId: uuid('contract_id')
    .notNull()
    .references(() => apiContracts.id, { onDelete: 'cascade' }),
  driftEventId: uuid('drift_event_id')
    .notNull()
    .references(() => driftEvents.id, { onDelete: 'cascade' }),
  adapterCode: text('adapter_code').notNull(),
  adapterSignature: varchar('adapter_signature', { length: 255 }).notNull(),
  confidenceScore: doublePrecision('confidence_score').notNull(),
  status: patchStatusEnum('status').default('GENERATING').notNull(),
  canaryPercent: integer('canary_percent').default(0).notNull(),
  deployedAt: timestamp('deployed_at', { withTimezone: true }),
  rolledBackAt: timestamp('rolled_back_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type PatchRegistry = typeof patchRegistries.$inferSelect;
export type NewPatchRegistry = typeof patchRegistries.$inferInsert;
