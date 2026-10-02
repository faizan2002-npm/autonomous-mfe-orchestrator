import { ContractService } from '../api-gateway/dist/observation/contract.service.js';
import { ObservationService } from '../api-gateway/dist/observation/observation.service.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { Redis } from 'ioredis';
import { eq } from 'drizzle-orm';
import * as schema from '@orchestrator/database';
import { generateText } from '@orchestrator/gemini-client';
import { InferenceService } from '../api-gateway/dist/cognitive/inference.service.js';
import { CognitiveService } from '../api-gateway/dist/cognitive/cognitive.service.js';
import { CanaryService } from '../api-gateway/dist/canary/canary.service.js';
import { loadGatewayConfig } from '../api-gateway/dist/config/gateway-config.js';
import { GatewayEventsService } from '../api-gateway/dist/events/gateway-events.service.js';
import { CanaryMetricsService } from '../api-gateway/dist/canary/canary-metrics.service.js';
import { GovernanceQueryService } from '../api-gateway/dist/governance/governance-query.service.js';

// Require explicit test endpoints: never silently target the application database.
const required = (name) => {
  assert.ok(
    process.env[name],
    `${name} must point to a disposable test service`,
  );
  return process.env[name];
};

test('live PostgreSQL migrations, drift dedupe, canary deployment, restart recovery, promotion and rollback', async () => {
  const client = postgres(required('TEST_DATABASE_URL'), { max: 2 });
  const db = drizzle(client);
  const redis = new Redis(required('TEST_REDIS_URL'), {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  const serviceName = `integration-${randomUUID()}`;
  const contract = { serviceName, httpMethod: 'GET', endpointPath: '/users' };
  // No GEMINI_API_KEY: patch generation uses the deterministic fallback.
  const config = loadGatewayConfig({
    DATABASE_URL: required('TEST_DATABASE_URL'),
    REDIS_URL: required('TEST_REDIS_URL'),
  });
  let serviceId;
  try {
    await migrate(db, {
      migrationsFolder: '../../packages/database/migrations',
    });
    await migrate(db, {
      migrationsFolder: '../../packages/database/migrations',
    });
    assert.equal(await redis.ping(), 'PONG');
    const [service] = await db
      .insert(schema.serviceRegistries)
      .values({
        serviceName,
        serviceType: 'REST',
        endpointUrl: 'http://localhost',
        mfeConsumer: 'integration',
      })
      .returning();
    serviceId = service.id;
    const contracts = new ContractService(db, redis, config);
    const response = { ...contract, observedPayload: { firstName: 'Ada' } };
    const [baseline, concurrentBaseline] = await Promise.all([
      contracts.getOrCreateBaseline(response),
      contracts.getOrCreateBaseline(response),
    ]);
    assert.deepEqual(baseline, concurrentBaseline);
    // A cache hit must work without making any database calls.
    assert.deepEqual(
      await new ContractService({}, redis, config).getOrCreateBaseline(
        response,
      ),
      baseline,
    );
    const scheduledTasks = [];
    const events = new GatewayEventsService();
    const published = [];
    events.stream().subscribe((event) => published.push(event));
    const metrics = new CanaryMetricsService(redis);
    const observation = new ObservationService(
      db,
      redis,
      contracts,
      { schedule: (task) => scheduledTasks.push(task) },
      config,
      events,
    );
    await observation.observe(response);
    assert.equal(scheduledTasks.length, 0);
    const drifted = { ...response, observedPayload: { first_name: 'Ada' } };
    await observation.observe(drifted);
    assert.equal(scheduledTasks.length, 1);
    // The same drifted shape is recorded and healed once, not on every request.
    await observation.observe(drifted);
    assert.equal(scheduledTasks.length, 1);
    assert.equal(
      (
        await db
          .select()
          .from(schema.driftEvents)
          .where(eq(schema.driftEvents.contractId, baseline.contractId))
      ).length,
      1,
    );
    const [task] = scheduledTasks;
    const [event] = await db
      .select()
      .from(schema.driftEvents)
      .where(eq(schema.driftEvents.id, task.driftEventId));
    assert.equal(event.contractId, baseline.contractId);
    assert.equal(event.driftType, 'FIELD_RENAMED');
    const [updatedService] = await db
      .select()
      .from(schema.serviceRegistries)
      .where(eq(schema.serviceRegistries.id, serviceId));
    assert.equal(updatedService.status, 'DRIFTING');
    assert.deepEqual(
      published.map((event) => event.type),
      ['drift.detected'],
    );
    // An adapter that runs but does not restore the contract is stored as FAILED, never deployed.
    const rejected = await new CognitiveService(
      db,
      {
        generate: async () => ({
          adapterCode: '(data) => data',
          reasoningTrace: 'Generated by Gemini (test)',
        }),
      },
      events,
    ).generateAndValidatePatch(task);
    assert.equal(rejected, null);
    const [failed] = await db
      .select()
      .from(schema.patchRegistries)
      .where(eq(schema.patchRegistries.driftEventId, task.driftEventId));
    assert.equal(failed.status, 'FAILED');
    assert.equal(published.at(-1).type, 'patch.rejected');
    const patch = await new CognitiveService(
      db,
      new InferenceService(config),
      events,
    ).generateAndValidatePatch(task);
    assert.ok(patch);
    assert.equal(published.at(-1).type, 'patch.generated');
    assert.equal(published.at(-1).generator, 'fallback');
    const audits = await db
      .select()
      .from(schema.governanceAudits)
      .where(eq(schema.governanceAudits.patchId, patch.patchId));
    assert.equal(audits.length, 1);
    assert.match(audits[0].reasoningTrace, /Fallback/);
    const canary = new CanaryService(db, config, metrics, events);
    await canary.deployPatch({
      patchId: patch.patchId,
      contractId: task.contractId,
      contract,
      adapterCode: patch.adapterCode,
    });
    assert.equal(
      canary.applyPatch(contract, task.samplePayload, false).isPatched,
      false,
    );
    assert.equal(
      canary.applyPatch(contract, task.samplePayload, true).payload.firstName,
      'Ada',
    );
    // Patches are scoped to their contract, not the whole service.
    assert.equal(
      canary.applyPatch(
        { ...contract, endpointPath: '/orders' },
        task.samplePayload,
        true,
      ).isPatched,
      false,
    );
    // A restarted gateway restores live patches from the database.
    const restarted = new CanaryService(db, config, metrics, events);
    await restarted.onApplicationBootstrap();
    assert.equal(
      restarted.applyPatch(contract, task.samplePayload, true).isPatched,
      true,
    );
    await canary.promotePatch(patch.patchId, serviceName);
    const [saved] = await db
      .select()
      .from(schema.patchRegistries)
      .where(eq(schema.patchRegistries.id, patch.patchId));
    assert.equal(saved.status, 'ACTIVE');
    const afterPromote = new CanaryService(db, config, metrics, events);
    await afterPromote.onApplicationBootstrap();
    assert.equal(
      afterPromote.applyPatch(contract, task.samplePayload, false).isPatched,
      true,
    );
    assert.equal(
      canary.applyPatch(contract, task.samplePayload, false).isPatched,
      true,
    );
    // Read models used by the dashboard.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const queries = new GovernanceQueryService(db, config, metrics);
    const detail = await queries.getPatch(patch.patchId);
    assert.equal(detail.status, 'ACTIVE');
    assert.equal(detail.generator, 'fallback');
    assert.equal(detail.driftEvent.id, task.driftEventId);
    assert.ok(detail.traffic.patchedRequests >= 2);
    assert.ok(detail.traffic.baselineRequests >= 1);
    const preview = await queries.previewPatch(patch.patchId);
    assert.equal(preview.success, true);
    assert.equal(preview.stillBreaking, false);
    assert.equal(preview.output.firstName, 'Ada');
    const drift = await queries.listDriftEvents({
      service: serviceName,
      limit: 10,
    });
    assert.equal(drift.items.length, 1);
    assert.equal(drift.items[0].patchId !== null, true);
    const stats = await queries.getStats();
    assert.ok(stats.patches.ACTIVE >= 1);
    assert.ok(stats.patches.FAILED >= 1);
    const failedPatches = await queries.listPatches({
      status: 'FAILED',
      service: serviceName,
    });
    assert.equal(failedPatches.length, 1);
    assert.equal(failedPatches[0].generator, 'gemini');
    const serviceDetail = await queries.getService(serviceName);
    assert.equal(serviceDetail.contracts.length, 1);
    assert.deepEqual(serviceDetail.contracts[0].schemaTokens, [
      'firstName:string',
    ]);
    await canary.rollbackPatch(patch.patchId, serviceName);
    // Rolling back forgets the handled drift, so the same shape re-triggers healing.
    await new Promise((resolve) => setTimeout(resolve, 200));
    await observation.observe(drifted);
    assert.equal(scheduledTasks.length, 2);
    const [rolledBack] = await db
      .select()
      .from(schema.patchRegistries)
      .where(eq(schema.patchRegistries.id, patch.patchId));
    assert.equal(rolledBack.status, 'ROLLED_BACK');
    const afterRollback = new CanaryService(db, config, metrics, events);
    await afterRollback.onApplicationBootstrap();
    assert.equal(
      afterRollback.applyPatch(contract, task.samplePayload, true).isPatched,
      false,
    );
    assert.equal(
      canary.applyPatch(contract, task.samplePayload, true).isPatched,
      false,
    );
  } finally {
    try {
      if (serviceId)
        await db
          .delete(schema.serviceRegistries)
          .where(eq(schema.serviceRegistries.id, serviceId));
      if (redis.status === 'ready') {
        const keys = await redis.keys(`*${serviceName}*`);
        if (keys.length) await redis.del(keys);
      }
    } finally {
      redis.disconnect();
      await client.end();
    }
  }
});

// Gemini tests call the real API, so they run only when a key is provided.
const geminiKey = process.env.TEST_GEMINI_API_KEY;
const geminiModel = process.env.TEST_GEMINI_MODEL || 'gemini-3.5-flash-lite';
const skipGemini = geminiKey ? false : 'TEST_GEMINI_API_KEY not set';

test(
  'live Gemini model produces a nonempty response',
  { skip: skipGemini },
  async () => {
    const response = await generateText({
      apiKey: geminiKey,
      model: geminiModel,
      prompt: 'Reply with the word OK.',
      timeoutMs: 60_000,
    });
    assert.ok(response.trim().length > 0);
  },
);

test(
  'Gemini generates a working adapter through InferenceService',
  { skip: skipGemini },
  async () => {
    const config = loadGatewayConfig({
      DATABASE_URL: required('TEST_DATABASE_URL'),
      REDIS_URL: required('TEST_REDIS_URL'),
      GEMINI_API_KEY: geminiKey,
      GEMINI_MODEL: geminiModel,
    });
    const result = await new InferenceService(config).generate({
      driftEventId: 'integration',
      contractId: 'integration',
      serviceName: 'integration',
      httpMethod: 'GET',
      endpointPath: '/users',
      expectedSchema: ['firstName:string'],
      diffDetails: {
        missingFields: ['firstName'],
        addedFields: ['first_name'],
        typeMismatches: [],
      },
      samplePayload: { first_name: 'Ada' },
    });
    assert.match(result.reasoningTrace, /^Generated by Gemini/);
    const { validateAdapterAst, executeInSandbox } =
      await import('@orchestrator/adapter-runtime');
    assert.equal(validateAdapterAst(result.adapterCode).valid, true);
    const executed = executeInSandbox(result.adapterCode, {
      first_name: 'Ada',
    });
    assert.equal(executed.success, true);
    assert.equal(executed.transformedOutput.firstName, 'Ada');
  },
);
