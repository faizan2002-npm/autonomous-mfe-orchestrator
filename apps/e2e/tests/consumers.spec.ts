import { test, expect } from '@playwright/test';

test.describe('Consumers and API Keys', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/o/demo/consumers');
  });

  test('reviewer creates a backend consumer', async ({ page }) => {
    await page.getByRole('button', { name: /create consumer/i }).click();
    
    await page.getByLabel('Consumer name').fill('report-service');
    await page.getByLabel('Kind').selectOption('backend');
    await page.getByRole('checkbox', { name: 'user-service' }).check();
    await page.getByRole('button', { name: /create/i }).click();

    await expect(page.getByText('report-service')).toBeVisible();
  });

  test('can issue and copy a secret key', async ({ page }) => {
    // Create consumer first
    await page.getByRole('button', { name: /create consumer/i }).click();
    await page.getByLabel('Consumer name').fill('api-consumer');
    await page.getByLabel('Kind').selectOption('backend');
    await page.getByRole('button', { name: /create/i }).click();

    // Issue key
    await page.getByRole('link', { name: 'api-consumer' }).click();
    await page.getByRole('button', { name: /issue key/i }).click();
    await page.getByLabel('Type').selectOption('secret');
    await page.getByRole('button', { name: /issue/i }).click();

    // Key shown once
    const keyInput = page.getByLabel(/sk_/);
    await expect(keyInput).toBeVisible();
    const keyValue = await keyInput.inputValue();
    expect(keyValue).toMatch(/^sk_/);

    // Copy button exists
    await page.getByRole('button', { name: /copy/i }).click();
    await expect(page.getByText(/copied/i)).toBeVisible();
  });

  test('can revoke a key', async ({ page }) => {
    // Navigate to a consumer
    await page.getByRole('link', { name: 'acme-portal' }).click();

    // Find and revoke a key
    const revokeButton = page.getByRole('button', { name: /revoke/i }).first();
    await revokeButton.click();
    await page.getByRole('button', { name: /confirm|revoke/i }).click();

    // Verify revoked state
    await expect(page.getByText(/revoked|inactive/i)).toBeVisible();
  });

  test('can grant service access', async ({ page }) => {
    await page.getByRole('link', { name: 'acme-portal' }).click();
    await page.getByRole('button', { name: /grant access|add service/i }).click();

    await page.getByLabel('Service').selectOption('user-service');
    await page.getByRole('button', { name: /grant|add/i }).click();

    await expect(page.getByText('user-service')).toBeVisible();
  });

  test('displays last-used timestamp', async ({ page }) => {
    await page.getByRole('link', { name: 'acme-portal' }).click();
    
    // Keys table should show last used
    await expect(page.getByText(/last used|never/i)).toBeVisible();
  });
});
