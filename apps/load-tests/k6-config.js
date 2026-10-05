/**
 * Shared k6 configuration for load testing.
 * Source: https://k6.io/docs/using-k6/options/
 */

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000/api';
export const ORG_SLUG = __ENV.ORG_SLUG || 'demo';
export const API_KEY = __ENV.API_KEY || 'demo-key';

export const HEADERS = {
  'x-api-key': API_KEY,
  'Content-Type': 'application/json',
};

export const THRESHOLDS = {
  'http_req_duration': ['p(95)<500', 'p(99)<1000'],
  'http_req_failed': ['rate<0.1'],
};

export const SUMMARY_TREND_STATS = ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'];
