import { Inject, Injectable } from '@nestjs/common';
import { decryptSecret } from '@orchestrator/crypto';
import { organizations, type DrizzleDb } from '@orchestrator/database';
import { eq } from 'drizzle-orm';
import {
  GATEWAY_CONFIG,
  type GatewayConfig,
} from '../config/gateway-config.js';
import { DRIZZLE_DB } from '../database/database.tokens.js';

export interface EffectiveSettings {
  driftThreshold: number;
  canaryPercent: number;
  gemini: { apiKey?: string; model: string };
}

const CACHE_MS = 30_000;

/** Org overrides merged over gateway defaults, cached briefly because every request needs them. */
@Injectable()
export class OrgSettingsService {
  private readonly cache = new Map<
    string,
    { at: number; value: EffectiveSettings }
  >();

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
  ) {}

  async effective(orgId: string): Promise<EffectiveSettings> {
    const hit = this.cache.get(orgId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const [org] = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    const value: EffectiveSettings = {
      driftThreshold: org?.driftThreshold ?? this.config.driftThreshold,
      canaryPercent: org?.canaryPercent ?? this.config.canaryPercent,
      gemini: {
        apiKey: org?.geminiApiKeyEnc
          ? decryptSecret(org.geminiApiKeyEnc, this.config.encryptionKey)
          : this.config.gemini.apiKey,
        model: org?.geminiModel ?? this.config.gemini.model,
      },
    };
    this.cache.set(orgId, { at: Date.now(), value });
    return value;
  }

  invalidate(orgId: string): void {
    this.cache.delete(orgId);
  }
}
