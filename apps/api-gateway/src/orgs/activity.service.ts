import { Inject, Injectable } from '@nestjs/common';
import { orgActivity, type DrizzleDb } from '@orchestrator/database';
import type { ActivityView } from '@orchestrator/shared-types';
import { desc, eq } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';

export interface ActivityEntry {
  actor: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  details?: Record<string, unknown>;
}

/** Administrative audit trail: who changed members, keys, services and settings. */
@Injectable()
export class ActivityService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async record(orgId: string, entry: ActivityEntry): Promise<void> {
    await this.db.insert(orgActivity).values({
      orgId,
      actor: entry.actor,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      details: entry.details ?? null,
    });
  }

  async list(orgId: string, limit: number): Promise<ActivityView[]> {
    const rows = await this.db
      .select()
      .from(orgActivity)
      .where(eq(orgActivity.orgId, orgId))
      .orderBy(desc(orgActivity.createdAt))
      .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      actor: row.actor,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      details: row.details,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
