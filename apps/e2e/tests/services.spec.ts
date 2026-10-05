import { test, expect } from '@playwright/test';

test.describe('Services Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/o/demo/services');
  });

  test('admin creates and configures a service', async ({ page }) => {
    // Create service
    await page.getByRole('button', { name: /create service/i }).click();
    await page.getByLabel('Service name').fill('payment-api');
    await page.getByLabel('Base URL').fill('http://payment.test/api');
    await page.getByLabel('Description').fill('Payment processing service');
    await page.getByRole('button', { name: /create/i }).click();

    // Verify in list
    await expect(page.getByText('payment-api')).toBeVisible();
    await expect(page.getByText('payment.test')).toBeVisible();
  });

  test('can test service connection', async ({ page }) => {
    // Navigate to first service
    await page.getByRole('link', { name: 'user-service' }).first().click();
    
    // Test connection
    await page.getByRole('button', { name: /test connection/i }).click();
    await expect(page.getByText(/reachable|unreachable/i)).toBeVisible({ timeout: 5000 });
  });

  test('admin adds encrypted upstream headers', async ({ page }) => {
    await page.getByRole('link', { name: 'user-service' }).first().click();
    await page.getByRole('button', { name: /configuration/i }).click();
    
    // Add header
    await page.getByRole('button', { name: /add header/i }).click();
    await page.getByLabel('Header name').fill('Authorization');
    await page.getByLabel('Header value').fill('Bearer secret-token');
    await page.getByRole('button', { name: /save/i }).click();

    // Verify header name shows but value is hidden
    await expect(page.getByText('Authorization')).toBeVisible();
    await expect(page.getByText('secret-token')).not.toBeVisible();
  });

  test('service detail shows contracts and drift', async ({ page }) => {
    await page.getByRole('link', { name: 'user-service' }).first().click();
    
    // Verify stats
    await expect(page.getByText(/contracts/i)).toBeVisible();
    await expect(page.getByText(/consumers observed/i)).toBeVisible();
    await expect(page.getByText(/last drift/i)).toBeVisible();
  });

  test('can delete a service', async ({ page }) => {
    // Create a temporary service
    await page.getByRole('button', { name: /create service/i }).click();
    await page.getByLabel('Service name').fill('temp-service');
    await page.getByLabel('Base URL').fill('http://temp.test/api');
    await page.getByRole('button', { name: /create/i }).click();

    // Navigate to it and delete
    await page.getByRole('link', { name: 'temp-service' }).click();
    await page.getByRole('button', { name: /delete/i }).click();
    await page.getByRole('button', { name: /confirm|delete/i }).click();

    // Verify removed
    await expect(page.getByText('temp-service')).not.toBeVisible();
  });
});
