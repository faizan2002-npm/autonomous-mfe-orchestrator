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
import { generateText } from '@orchestrator/ollama-client';
import { InferenceService } from '../api-gateway/dist/cognitive/inference.service.js';
import { CognitiveService } from '../api-gateway/dist/cognitive/cognitive.service.js';
import { CanaryService } from '../api-gateway/dist/canary/canary.service.js';

// Require explicit test endpoints: never silently target the application database.
const required = (name) => {
  assert.ok(
    process.env[name],
    `${name} must point to a disposable test service`,
  );
  return process.env[name];
};

test('live PostgreSQL migrations, patch persistence, Redis canary deployment and promotion', async () => {
  const client = postgres(required('TEST_DATABASE_URL'), { max: 2 });
  const db = drizzle(client);
  const redis = new Redis(required('TEST_REDIS_URL'), {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  const serviceName = `integration-${randomUUID()}`;
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
    const contracts = new ContractService(db, redis);
    const response = {
      serviceName,
      endpointPath: '/users',
      httpMethod: 'GET',
      observedPayload: { firstName: 'Ada' },
    };
    const [baseline, concurrentBaseline] = await Promise.all([
      contracts.getOrCreateBaseline(response),
      contracts.getOrCreateBaseline(response),
    ]);
    assert.deepEqual(baseline, concurrentBaseline);
    // A cache hit must work without making any database calls.
    assert.deepEqual(
      await new ContractService({}, redis).getOrCreateBaseline(response),
      baseline,
    );
    const scheduledTasks = [];
    const observation = new ObservationService(db, contracts, {
      schedule: (task) => scheduledTasks.push(task),
    });
    await observation.observe(response);
    assert.equal(scheduledTasks.length, 0);
    await observation.observe({
      ...response,
      observedPayload: { first_name: 'Ada' },
    });
    assert.equal(scheduledTasks.length, 1);
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
    // Real Ollama failure response exercises the deterministic fallback, not a mock.
    process.env.OLLAMA_BASE_URL = required('TEST_OLLAMA_URL');
    process.env.OLLAMA_MODEL = `missing-integration-model-${randomUUID()}`;
    const patch = await new CognitiveService(
      db,
      new InferenceService(),
    ).generateAndValidatePatch(task);
    assert.ok(patch);
    const audits = await db
      .select()
      .from(schema.governanceAudits)
      .where(eq(schema.governanceAudits.patchId, patch.patchId));
    assert.equal(audits.length, 1);
    assert.match(audits[0].reasoningTrace, /Fallback/);
    const canary = new CanaryService(db, redis);
    await canary.deployPatch(serviceName, patch.patchId, patch.adapterCode);
    assert.equal(
      JSON.parse(await redis.get(`active_patch:${serviceName}`)).patchId,
      patch.patchId,
    );
    assert.equal(
      canary.applyPatchIfActive(serviceName, task.samplePayload, false)
        .isPatched,
      false,
    );
    assert.equal(
      canary.applyPatchIfActive(serviceName, task.samplePayload, true).payload
        .firstName,
      'Ada',
    );
    await canary.promotePatch(patch.patchId, serviceName);
    const [saved] = await db
      .select()
      .from(schema.patchRegistries)
      .where(eq(schema.patchRegistries.id, patch.patchId));
    assert.equal(saved.status, 'ACTIVE');
    assert.equal(
      JSON.parse(await redis.get(`active_patch:${serviceName}`)).canaryPercent,
      100,
    );
    assert.equal(
      canary.applyPatchIfActive(serviceName, task.samplePayload, false)
        .isPatched,
      true,
    );
  } finally {
    try {
      if (serviceId)
        await db
          .delete(schema.serviceRegistries)
          .where(eq(schema.serviceRegistries.id, serviceId));
      if (redis.status === 'ready')
        await redis.del(
          `active_patch:${serviceName}`,
          `contract:v2:${serviceName}:GET:/users`,
        );
    } finally {
      redis.disconnect();
      await client.end();
    }
  }
});

test('live Ollama model produces a nonempty response without fallback', async () => {
  const response = await generateText({
    baseUrl: required('TEST_OLLAMA_URL'),
    model: required('TEST_OLLAMA_MODEL'),
    prompt: 'Reply with the word OK.',
    timeoutMs: 120_000,
  });
  assert.ok(response.trim().length > 0);
});

test('configured Ollama model generates a working adapter through InferenceService', async () => {
  process.env.OLLAMA_BASE_URL = required('TEST_OLLAMA_URL');
  process.env.OLLAMA_MODEL = required('TEST_OLLAMA_MODEL');
  const result = await new InferenceService().generate({
    driftEventId: 'integration',
    contractId: 'integration',
    serviceName: 'integration',
    endpointPath: '/users',
    expectedSchema: ['firstName:string'],
    diffDetails: {
      missingFields: ['firstName'],
      addedFields: ['first_name'],
      typeMismatches: [],
    },
    samplePayload: { first_name: 'Ada' },
  });
  assert.match(result.reasoningTrace, /^Generated by Ollama/);
  const { validateAdapterAst, executeInSandbox } =
    await import('@orchestrator/adapter-runtime');
  assert.equal(validateAdapterAst(result.adapterCode).valid, true);
  const executed = executeInSandbox(result.adapterCode, { first_name: 'Ada' });
  assert.equal(executed.success, true);
  assert.equal(executed.transformedOutput.firstName, 'Ada');
});
