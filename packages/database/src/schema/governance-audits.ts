import { GOVERNANCE_STATUSES } from '@orchestrator/shared-types';
import { pgTable, uuid, varchar, text, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { driftEvents } from './drift-events.js';
import { patchRegistries } from './patch-registries.js';

export const governanceStatusEnum = pgEnum('governance_status', GOVERNANCE_STATUSES);

export const governanceAudits = pgTable('governance_audits', {
  id: uuid('id').defaultRandom().primaryKey(),
  driftEventId: uuid('drift_event_id')
    .notNull()
    .references(() => driftEvents.id, { onDelete: 'cascade' }),
  patchId: uuid('patch_id').references(() => patchRegistries.id, { onDelete: 'set null' }),
  status: governanceStatusEnum('status').default('PENDING_REVIEW').notNull(),
  reviewer: varchar('reviewer', { length: 255 }),
  reviewNotes: text('review_notes'),
  reasoningTrace: text('reasoning_trace').notNull(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type GovernanceAudit = typeof governanceAudits.$inferSelect;
export type NewGovernanceAudit = typeof governanceAudits.$inferInsert;
