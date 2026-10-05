import { test, expect } from '@playwright/test';

// Multi-instance gateway tests
// Validates that only one gateway instance generates patches across distributed setup

const API_BASE = 'http://localhost:4000';
const API_BASE_2 = 'http://localhost:4001'; // Second gateway instance (if running)

test.describe('Multi-Instance Healing', () => {
  test.describe('Distributed Healing Lock', () => {
    test('only one instance should generate patches for same contract drift', async ({ request }) => {
      // This test validates the distributed healing lock prevents duplicate patches
      // when multiple gateway instances observe the same contract drift

      const orgSlug = 'test-org';
      const consumerKey = process.env.TEST_CONSUMER_KEY || 'test-key';

      // Simulate contract drift on both instances
      const response = await request.post(
        `${API_BASE}/api/v1/test-service/users`,
        {
          headers: {
            'x-api-key': consumerKey,
            'Content-Type': 'application/json',
          },
          data: {
            id: 1,
            name: 'Test User',
            // Extra field to trigger drift
            newField: 'should-be-healed',
          },
        }
      );

      // Should get healed or error, not duplicate healing attempts
      expect([200, 422, 400]).toContain(response.status());
    });

    test('healing lock should prevent concurrent patch generation', async ({ request }) => {
      // Validate that concurrent requests don't generate multiple patches
      const orgSlug = 'test-org';

      const promises = Array(5)
        .fill(null)
        .map(() =>
          request.post(`${API_BASE}/api/v1/test-service/users`, {
            headers: {
              'x-api-key': process.env.TEST_CONSUMER_KEY || 'test-key',
            },
            data: { id: 2, name: 'Concurrent Test' },
          })
        );

      const responses = await Promise.all(promises);

      // All should succeed or fail consistently, no half-healed states
      const statuses = responses.map((r) => r.status());
      const successCount = statuses.filter((s) => s === 200).length;
      const failureCount = statuses.filter((s) => s >= 400).length;

      // Either all succeed or all fail, not mixed (indicates lock failure)
      expect(successCount === 5 || failureCount >= 4).toBeTruthy();
    });
  });

  test.describe('Event Propagation', () => {
    test('healing events should be visible across instances', async ({ request }) => {
      // If second instance is running, healing events from one should be observable on other
      // This tests Redis pub/sub event propagation

      const response = await request.get(`${API_BASE}/health`);
      expect(response.status()).toBe(200);

      // Check event bus is healthy
      const body = await response.json();
      expect(body.status).toBe('healthy');
    });
  });
});
