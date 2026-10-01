import { Injectable, Inject } from '@nestjs/common';
import {
  type DrizzleDb,
  serviceRegistries,
  driftEvents,
  patchRegistries,
  governanceAudits,
} from '@orchestrator/database';
import { desc } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';

@Injectable()
export class GovernanceService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async getOverview() {
    const [services, events, patches, audits] = await Promise.all([
      this.db.select().from(serviceRegistries),
      this.db
        .select()
        .from(driftEvents)
        .orderBy(desc(driftEvents.detectedAt))
        .limit(20),
      this.db
        .select()
        .from(patchRegistries)
        .orderBy(desc(patchRegistries.createdAt))
        .limit(10),
      this.db
        .select()
        .from(governanceAudits)
        .orderBy(desc(governanceAudits.createdAt))
        .limit(10),
    ]);

    return {
      services,
      driftEvents: events,
      patches,
      audits,
    };
  }
}
