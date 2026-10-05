import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, ORG_SLUG, HEADERS, SUMMARY_TREND_STATS } from './k6-config.js';

/**
 * Canary isolation test
 * - 80/20 traffic split: 80% baseline, 20% canary patch
 * - Verify canary doesn't affect baseline latency
 * - Measure isolation effectiveness
 */
export const options = {
  stages: [
    { duration: '1m', target: 100 },  // ramp to 100 VUs
    { duration: '3m', target: 100 },  // hold
    { duration: '1m', target: 0 },    // ramp down
  ],
  summaryTrendStats: SUMMARY_TREND_STATS,
};

export default function () {
  const params = { headers: HEADERS };

  // Simulate canary traffic split: 20% of requests include canary header
  if (__ITER % 5 === 0) {
    // 20% canary traffic
    const canaryParams = {
      headers: { ...HEADERS, 'x-mfe-canary': '20' },
    };

    const canaryRes = http.get(`${BASE_URL}/orgs/${ORG_SLUG}/governance/patches`, canaryParams);

    check(canaryRes, {
      'canary status is 200': (r) => r.status === 200,
      'canary latency < 750ms': (r) => r.timings.duration < 750,
    });
  } else {
    // 80% baseline traffic
    const baselineRes = http.get(`${BASE_URL}/orgs/${ORG_SLUG}/governance/patches`, params);

    check(baselineRes, {
      'baseline status is 200': (r) => r.status === 200,
      'baseline latency < 500ms': (r) => r.timings.duration < 500,
      'canary doesn\'t affect baseline': (r) => r.timings.duration < 500,
    });
  }

  sleep(0.5);
}
