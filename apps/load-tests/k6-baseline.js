import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, ORG_SLUG, HEADERS, THRESHOLDS, SUMMARY_TREND_STATS } from './k6-config.js';

/**
 * Baseline throughput and latency test
 * - 100 concurrent virtual users
 * - 5 minute duration
 * - Measure latency p50/p95/p99, error rate
 */
export const options = {
  stages: [
    { duration: '1m', target: 100 }, // ramp up to 100 VUs
    { duration: '3m', target: 100 }, // hold at 100 VUs
    { duration: '1m', target: 0 },   // ramp down
  ],
  thresholds: THRESHOLDS,
  summaryTrendStats: SUMMARY_TREND_STATS,
};

export default function () {
  const patchesRes = http.get(`${BASE_URL}/orgs/${ORG_SLUG}/governance/patches`, {
    headers: HEADERS,
  });

  check(patchesRes, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  const driftRes = http.get(
    `${BASE_URL}/orgs/${ORG_SLUG}/governance/drift-events?limit=25`,
    { headers: HEADERS }
  );

  check(driftRes, {
    'drift status is 200': (r) => r.status === 200,
    'drift response time < 500ms': (r) => r.timings.duration < 500,
  });

  sleep(1);
}
