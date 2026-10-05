// Redis-backed circuit breaker: CLOSED -> OPEN -> HALF_OPEN -> CLOSED, shared across instances.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Redis from 'ioredis';
import { dist, redisUrl, suffix } from './helpers/gateway.mjs';

const { CircuitBreakerService, CircuitState } = await dist('common/circuit-breaker.service.js');

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const ok = async () => 'ok';
const boom = async () => {
  throw new Error('upstream down');
};

describe('Circuit Breaker (Integration)', () => {
  let redis1;
  let redis2;
  // Two gateway instances sharing one Redis.
  let instance1;
  let instance2;

  before(() => {
    redis1 = new Redis(redisUrl);
    redis2 = new Redis(redisUrl);
    instance1 = new CircuitBreakerService(redis1);
    instance2 = new CircuitBreakerService(redis2);
  });

  after(async () => {
    await redis1.quit();
    await redis2.quit();
  });

  const options = { failureThreshold: 3, resetTimeoutMs: 200, halfOpenRequests: 2 };

  test('opens after the failure threshold and fails fast while open', async () => {
    const key = `cb-open-${suffix()}`;
    const breaker = instance1.get(key, options);
    assert.equal(await breaker.getStateValue(), CircuitState.CLOSED);
    for (let i = 0; i < 3; i++) await assert.rejects(breaker.execute(boom));
    assert.equal(await breaker.getStateValue(), CircuitState.OPEN);

    let called = false;
    const result = await breaker.execute(async () => {
      called = true;
      return 'ok';
    });
    assert.equal(result, undefined, 'open breaker returns undefined');
    assert.equal(called, false, 'open breaker does not call the task');
  });

  test('a success while closed resets the failure count', async () => {
    const breaker = instance1.get(`cb-reset-${suffix()}`, options);
    await assert.rejects(breaker.execute(boom));
    await assert.rejects(breaker.execute(boom));
    assert.equal(await breaker.execute(ok), 'ok');
    await assert.rejects(breaker.execute(boom));
    await assert.rejects(breaker.execute(boom));
    assert.equal(await breaker.getStateValue(), CircuitState.CLOSED);
  });

  test('recovers through HALF_OPEN after the reset timeout', async () => {
    const breaker = instance1.get(`cb-recover-${suffix()}`, options);
    for (let i = 0; i < 3; i++) await assert.rejects(breaker.execute(boom));
    await sleep(250);
    assert.equal(await breaker.execute(ok), 'ok');
    assert.equal(await breaker.getStateValue(), CircuitState.HALF_OPEN);
    assert.equal(await breaker.execute(ok), 'ok');
    assert.equal(await breaker.getStateValue(), CircuitState.CLOSED);
  });

  test('a failure in HALF_OPEN opens the breaker again', async () => {
    const breaker = instance1.get(`cb-reopen-${suffix()}`, options);
    for (let i = 0; i < 3; i++) await assert.rejects(breaker.execute(boom));
    await sleep(250);
    await assert.rejects(breaker.execute(boom));
    assert.equal(await breaker.getStateValue(), CircuitState.OPEN);
    assert.equal(await breaker.execute(ok), undefined);
  });

  test('state is shared between instances', async () => {
    const key = `cb-shared-${suffix()}`;
    const first = instance1.get(key, options);
    const second = instance2.get(key, options);
    for (let i = 0; i < 3; i++) await assert.rejects(first.execute(boom));
    assert.equal(await second.getStateValue(), CircuitState.OPEN);
    assert.equal(await second.execute(ok), undefined);
  });
});
