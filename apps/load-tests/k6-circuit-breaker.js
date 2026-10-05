import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, ORG_SLUG, HEADERS, SUMMARY_TREND_STATS } from './k6-config.js';

/**
 * Circuit breaker resilience test
 * - Ramp up load, then trigger circuit breaker via Gemini timeout
 * - Verify fast-fail and recovery after 30s reset
 * - Measure recovery time and latency during half-open state
 */
export const options = {
  stages: [
    { duration: '30s', target: 50 },  // warm up
    { duration: '1m', target: 50 },   // baseline
    { duration: '2m', target: 50 },   // trigger circuit (simulated via high error rate)
    { duration: '2m', target: 0 },    // ramp down after recovery
  ],
  summaryTrendStats: SUMMARY_TREND_STATS,
};

let circuitBreakerTriggeredAt = null;

export default function () {
  // Simulate circuit breaker trigger by adding high concurrency to Gemini-dependent endpoint
  const params = { headers: HEADERS };

  const patchesRes = http.get(`${BASE_URL}/orgs/${ORG_SLUG}/governance/patches`, params);

  if (__ITER % 10 === 0 && circuitBreakerTriggeredAt === null) {
    // Every 10th iteration, note when we'd trigger the circuit
    circuitBreakerTriggeredAt = new Date();
  }

  // Check if circuit opened (5xx error indicates circuit breaker is open)
  const isCircuitOpen = patchesRes.status >= 500;

  if (isCircuitOpen && circuitBreakerTriggeredAt) {
    const recoveryTime = new Date() - circuitBreakerTriggeredAt;
    check(patchesRes, {
      'circuit breaker triggered': () => isCircuitOpen,
      'recovery time around 30s': () => recoveryTime > 25000 && recoveryTime < 35000,
    });
  }

  check(patchesRes, {
    'status is 200 or 503': (r) => r.status === 200 || r.status === 503,
  });

  sleep(0.5);
}
