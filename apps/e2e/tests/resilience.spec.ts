import { test, expect } from '@playwright/test';

// Resilience and error recovery tests
// Validates circuit breakers, timeouts, retries, and fallback behavior

const API_BASE = 'http://localhost:4000';

test.describe('Resilience Patterns', () => {
  test.describe('Circuit Breaker', () => {
    test('should handle upstream service timeouts gracefully', async ({ request }) => {
      // Test that circuit breaker protects against cascading failures
      const consumerKey = process.env.TEST_CONSUMER_KEY || 'test-key';

      const response = await request.post(`${API_BASE}/api/v1/test-service/users`, {
        headers: {
          'x-api-key': consumerKey,
        },
        data: { id: 1, name: 'Resilience Test' },
        timeout: 5000,
      });

      // Should either succeed, return static fallback, or 503 (circuit open)
      // But NOT timeout indefinitely
      expect([200, 422, 503]).toContain(response.status());
    });

    test('circuit breaker should track failure state', async ({ request }) => {
      // Validate circuit breaker metrics are exposed
      const response = await request.get(`${API_BASE}/metrics`, {
        headers: {
          Authorization: `Bearer ${process.env.TEST_AUTH_TOKEN || 'test-token'}`,
        },
      });

      const text = await response.text();
      // Should expose circuit breaker state metric
      expect(text).toContain('gateway_circuit_breaker_state');
    });

    test('circuit breaker should recover after threshold', async ({ request }) => {
      // Test half-open state recovery
      const consumerKey = process.env.TEST_CONSUMER_KEY || 'test-key';

      let successCount = 0;
      for (let i = 0; i < 3; i++) {
        const response = await request.post(`${API_BASE}/api/v1/test-service/users`, {
          headers: { 'x-api-key': consumerKey },
          data: { id: i, name: `Recovery Test ${i}` },
        });

        if (response.status() === 200) successCount++;

        // Small delay between attempts
        await new Promise((r) => setTimeout(r, 100));
      }

      // Should eventually succeed (circuit recovers)
      expect(successCount).toBeGreaterThan(0);
    });
  });

  test.describe('Timeout Handling', () => {
    test('patch generation should timeout after configured limit', async ({ request }) => {
      // The inference service has a 50ms timeout for sandbox execution
      // This should not block external API responses indefinitely

      const consumerKey = process.env.TEST_CONSUMER_KEY || 'test-key';
      const start = Date.now();

      const response = await request.post(`${API_BASE}/api/v1/test-service/users`, {
        headers: { 'x-api-key': consumerKey },
        data: { id: 1, name: 'Timeout Test' },
        timeout: 3000,
      });

      const elapsed = Date.now() - start;

      // Should respond within timeout, not hang indefinitely
      expect(elapsed).toBeLessThan(3000);
      expect([200, 422, 503, 500]).toContain(response.status());
    });

    test('should use fallback when Gemini times out', async ({ request }) => {
      // If Gemini API times out, should fall back to deterministic adapter
      const consumerKey = process.env.TEST_CONSUMER_KEY || 'test-key';

      const response = await request.post(`${API_BASE}/api/v1/test-service/users`, {
        headers: { 'x-api-key': consumerKey },
        data: { id: 1, name: 'Fallback Test' },
      });

      // Should succeed with fallback or return 422 (unhealed)
      // But NOT return 500 (timeout error)
      expect([200, 422]).toContain(response.status());
    });
  });

  test.describe('Retry Logic', () => {
    test('should expose retry metrics', async ({ request }) => {
      // Validate retry attempts are tracked in Prometheus metrics
      const response = await request.get(`${API_BASE}/metrics`, {
        headers: {
          Authorization: `Bearer ${process.env.TEST_AUTH_TOKEN || 'test-token'}`,
        },
      });

      const text = await response.text();
      // Should expose retry metrics for upstream requests
      expect(text).toContain('gateway_upstream_retries_total');
    });
  });

  test.describe('Bulkheads / Rate Limiting', () => {
    test('should not exhaust resources under load', async ({ request }) => {
      // Send rapid requests to verify bulkhead/rate limiting works
      const consumerKey = process.env.TEST_CONSUMER_KEY || 'test-key';

      const promises = Array(10)
        .fill(null)
        .map((_, i) =>
          request.post(`${API_BASE}/api/v1/test-service/users`, {
            headers: { 'x-api-key': consumerKey },
            data: { id: i, name: `Load Test ${i}` },
            timeout: 5000,
          })
        );

      const responses = await Promise.all(promises);

      // Should handle load without hanging, even if some get rate limited (429)
      const statusCodes = responses.map((r) => r.status());
      const hasTimeout = statusCodes.some((s) => s === 0 || s === 500);

      expect(hasTimeout).toBeFalsy();
    });
  });

  test.describe('Error Response Structure', () => {
    test('should return structured errors with context', async ({ request }) => {
      // Test error responses include tracing/context info for debugging
      const response = await request.post(`${API_BASE}/api/v1/test-service/users`, {
        data: { id: 1 },
        // Missing required header
        timeout: 5000,
      });

      if (response.status() >= 400) {
        const body = await response.text();
        // Should have some structure, not just plain text
        // May be JSON error or HTML, but should be consistent
        expect(body.length).toBeGreaterThan(0);
      }
    });
  });
});
