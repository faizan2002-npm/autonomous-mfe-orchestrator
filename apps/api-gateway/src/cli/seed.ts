/**
 * Seeds a ready-to-demo tenant: the Demo Organization, its two mock services, a frontend
 * consumer (acme-portal) and a backend consumer (report-service), each with a fresh key.
 *
 *   pnpm db:seed                          # print the new keys
 *   pnpm db:seed --write-env              # store them in .env instead of printing
 *   pnpm db:seed --owner you@example.com  # invite yourself as owner (prints the accept link)
 *
 * Safe to re-run: existing rows are reused and keys from earlier seed runs are revoked.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateApiKey, hashToken, randomToken } from '@orchestrator/crypto';
import {
  consumerKeys,
  consumerServices,
  consumers,
  createDatabaseConnection,
  orgInvitations,
  organizations,
  serviceRegistries,
} from '@orchestrator/database';
import { and, eq, isNull } from 'drizzle-orm';
import { loadGatewayConfig } from '../config/gateway-config.js';

const ROOT_ENV = resolve(import.meta.dirname, '../../../../.env');
const SEED_ACTOR = 'seed';
const args = process.argv.slice(2);
const ownerEmail = args.includes('--owner')
  ? args[args.indexOf('--owner') + 1]
  : undefined;
const writeEnv = args.includes('--write-env');

if (existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);
const config = loadGatewayConfig(process.env);
const { db, close } = createDatabaseConnection(config.databaseUrl);

const FRONTEND_ORIGINS = [
  'http://localhost:5000',
  'http://localhost:5001',
  'http://localhost:5002',
  config.appUrl,
];

async function upsertOrg() {
  await db
    .insert(organizations)
    .values({ slug: 'demo', name: 'Demo Organization' })
    .onConflictDoNothing();
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, 'demo'));
  return org;
}

async function upsertService(
  orgId: string,
  serviceName: string,
  baseUrl: string,
  description: string,
) {
  await db
    .insert(serviceRegistries)
    .values({
      orgId,
      serviceName,
      endpointUrl: baseUrl,
      description,
      healthPath: '/health',
    })
    // The demo services follow USER_SERVICE_URL / ORDER_SERVICE_URL on every run.
    .onConflictDoUpdate({
      target: [serviceRegistries.orgId, serviceRegistries.serviceName],
      set: {
        endpointUrl: baseUrl,
        healthPath: '/health',
        updatedAt: new Date(),
      },
    });
  const [service] = await db
    .select()
    .from(serviceRegistries)
    .where(
      and(
        eq(serviceRegistries.orgId, orgId),
        eq(serviceRegistries.serviceName, serviceName),
      ),
    );
  return service;
}

async function upsertConsumer(
  orgId: string,
  name: string,
  kind: 'frontend' | 'backend',
  description: string,
  serviceIds: string[],
) {
  await db
    .insert(consumers)
    .values({ orgId, name, kind, description })
    .onConflictDoNothing();
  const [consumer] = await db
    .select()
    .from(consumers)
    .where(and(eq(consumers.orgId, orgId), eq(consumers.name, name)));
  for (const serviceId of serviceIds)
    await db
      .insert(consumerServices)
      .values({ consumerId: consumer.id, serviceId })
      .onConflictDoNothing();
  return consumer;
}

async function issueKey(
  orgId: string,
  consumerId: string,
  type: 'publishable' | 'secret',
  origins: string[],
) {
  await db
    .update(consumerKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(consumerKeys.consumerId, consumerId),
        eq(consumerKeys.createdBy, SEED_ACTOR),
        isNull(consumerKeys.revokedAt),
      ),
    );
  const { key, display } = generateApiKey(type);
  await db.insert(consumerKeys).values({
    orgId,
    consumerId,
    type,
    prefix: display,
    keyHash: hashToken(key, config.keyPepper),
    allowedOrigins: type === 'publishable' ? origins : [],
    createdBy: SEED_ACTOR,
  });
  return key;
}

function setEnv(values: Record<string, string>) {
  let text = existsSync(ROOT_ENV) ? readFileSync(ROOT_ENV, 'utf8') : '';
  for (const [name, value] of Object.entries(values)) {
    const line = `${name}="${value}"`;
    text = new RegExp(`^${name}=.*$`, 'm').test(text)
      ? text.replace(new RegExp(`^${name}=.*$`, 'm'), line)
      : `${text.replace(/\n?$/, '\n')}${line}\n`;
  }
  writeFileSync(ROOT_ENV, text, { mode: 0o600 });
}

try {
  const org = await upsertOrg();
  const users = await upsertService(
    org.id,
    'user-service',
    process.env.USER_SERVICE_URL || 'http://localhost:3001',
    'Mock user profiles with a chaos switch',
  );
  const orders = await upsertService(
    org.id,
    'order-service',
    process.env.ORDER_SERVICE_URL || 'http://localhost:3002',
    'Mock orders with a chaos switch',
  );
  const portal = await upsertConsumer(
    org.id,
    'acme-portal',
    'frontend',
    'Module Federation shell and remotes',
    [users.id, orders.id],
  );
  const reports = await upsertConsumer(
    org.id,
    'report-service',
    'backend',
    'Backend that builds order reports',
    [orders.id],
  );
  const portalKey = await issueKey(
    org.id,
    portal.id,
    'publishable',
    FRONTEND_ORIGINS,
  );
  const reportKey = await issueKey(org.id, reports.id, 'secret', []);

  console.log(
    `Demo Organization ready (slug "demo"): user-service, order-service, acme-portal, report-service.`,
  );
  if (writeEnv) {
    setEnv({ VITE_MFE_CONSUMER_KEY: portalKey, REPORT_SERVICE_KEY: reportKey });
    console.log(
      'Wrote VITE_MFE_CONSUMER_KEY and REPORT_SERVICE_KEY to .env (previous seed keys revoked).',
    );
  } else {
    console.log(`VITE_MFE_CONSUMER_KEY=${portalKey}`);
    console.log(`REPORT_SERVICE_KEY=${reportKey}`);
  }

  if (ownerEmail) {
    const token = randomToken();
    await db.insert(orgInvitations).values({
      orgId: org.id,
      email: ownerEmail.toLowerCase(),
      role: 'owner',
      tokenHash: hashToken(token, config.keyPepper),
      // System invitation: there is no inviting user.
      invitedBy: '00000000-0000-0000-0000-000000000000',
      expiresAt: new Date(Date.now() + 7 * 24 * 3_600_000),
    });
    console.log(
      `Owner invitation for ${ownerEmail}: ${config.appUrl}/invite/${token}`,
    );
  }
} finally {
  await close();
}
