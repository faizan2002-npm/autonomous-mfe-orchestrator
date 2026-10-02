// Shared by unit tests only.
import { randomBytes } from 'node:crypto';
import {
  loadGatewayConfig,
  type GatewayConfig,
} from '../config/gateway-config.js';

/** A complete, valid environment; override single variables per test. */
export function testEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    DATABASE_URL: 'postgresql://localhost/unused',
    REDIS_URL: 'redis://localhost/unused',
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    KEY_PEPPER: randomBytes(32).toString('base64'),
    ...overrides,
  };
}

export const testConfig = (
  overrides: Record<string, string | undefined> = {},
): GatewayConfig => loadGatewayConfig(testEnv(overrides));
