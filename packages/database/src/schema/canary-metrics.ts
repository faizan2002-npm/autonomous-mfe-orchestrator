import {
  pgTable,
  uuid,
  integer,
  doublePrecision,
  boolean,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { patchRegistries } from './patch-registries.js';

export const canaryMetrics = pgTable('canary_metrics', {
  id: uuid('id').defaultRandom().primaryKey(),
  patchId: uuid('patch_id')
    .notNull()
    .references(() => patchRegistries.id, { onDelete: 'cascade' }),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  windowEnd: timestamp('window_end', { withTimezone: true }).notNull(),
  baselineRequests: integer('baseline_requests').notNull(),
  baselineErrors: integer('baseline_errors').notNull(),
  canaryRequests: integer('canary_requests').notNull(),
  canaryErrors: integer('canary_errors').notNull(),
  avgLatencyMs: doublePrecision('avg_latency_ms').notNull(),
  promoted: boolean('promoted').default(false).notNull(),
  evaluationNotes: text('evaluation_notes'),
});

export type CanaryMetric = typeof canaryMetrics.$inferSelect;
export type NewCanaryMetric = typeof canaryMetrics.$inferInsert;
