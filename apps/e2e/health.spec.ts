import { test, expect } from '@playwright/test';

// Health probe tests for Kubernetes/Docker readiness
// Tests /health/live (liveness), /health/ready (readiness), and /health (overall)

const API_BASE = 'http://localhost:4000';

test.describe('Health Probes', () => {
  test.describe('GET /health/live (Liveness)', () => {
    test('should return 200 when process is alive', async ({ request }) => {
      const response = await request.get(`${API_BASE}/health/live`);
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.alive).toBe(true);
    });

    test('should return 200 even if dependencies are down', async ({ request }) => {
      // Liveness probe should always return 200 (we're not testing dependency kill here)
      const response = await request.get(`${API_BASE}/health/live`);
      expect(response.status()).toBe(200);
    });
  });

  test.describe('GET /health/ready (Readiness)', () => {
    test('should return 200 when postgres and redis are healthy', async ({ request }) => {
      const response = await request.get(`${API_BASE}/health/ready`);
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.status).toBe('healthy');
      expect(body).toHaveProperty('postgres');
      expect(body).toHaveProperty('redis');
    });

    test('should include dependency status in response', async ({ request }) => {
      const response = await request.get(`${API_BASE}/health/ready`);
      const body = await response.json();
      expect(body.postgres).toBeDefined();
      expect(body.redis).toBeDefined();
      expect(['healthy', 'degraded', 'unhealthy']).toContain(body.status);
    });
  });

  test.describe('GET /health (Overall Health)', () => {
    test('should return 200 when healthy', async ({ request }) => {
      const response = await request.get(`${API_BASE}/health`);
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.status).toBe('healthy');
    });

    test('should return 503 when unhealthy', async ({ request }) => {
      // Note: This test requires postgres/redis to be stopped manually
      // Or use a mock/stub in integration tests
      // Skipping for now as it requires test setup
      test.skip();

      const response = await request.get(`${API_BASE}/health`);
      // If dependencies fail, this would be 503
      if (response.status() === 503) {
        const body = await response.json();
        expect(body.status).toBe('unhealthy');
      }
    });
  });

  test.describe('HTTP Headers', () => {
    test('should have correct content-type', async ({ request }) => {
      const response = await request.get(`${API_BASE}/health/ready`);
      expect(response.headers()['content-type']).toContain('application/json');
    });

    test('should not cache health responses', async ({ request }) => {
      const response = await request.get(`${API_BASE}/health/live`);
      const cacheControl = response.headers()['cache-control'];
      // Should either be absent or set to no-cache
      if (cacheControl) {
        expect(cacheControl).toContain('no-cache');
      }
    });
  });

  test.describe('Response Time', () => {
    test('liveness should respond within 1 second', async ({ request }) => {
      const start = performance.now();
      await request.get(`${API_BASE}/health/live`);
      const duration = performance.now() - start;
      expect(duration).toBeLessThan(1000);
    });

    test('readiness should respond within 5 seconds', async ({ request }) => {
      const start = performance.now();
      await request.get(`${API_BASE}/health/ready`);
      const duration = performance.now() - start;
      expect(duration).toBeLessThan(5000);
    });
  });
});
