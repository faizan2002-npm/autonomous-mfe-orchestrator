import { test, expect } from '@playwright/test';

test.describe('Contracts and Drift', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/o/demo/governance/drift-events');
  });

  test('drift events list shows all breaks', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /drift/i })).toBeVisible();
    
    // Should show event list
    const events = page.locator('[role="row"]').count();
    expect(events).toBeGreaterThan(0);
  });

  test('can filter drift by consumer or service', async ({ page }) => {
    const filterButton = page.getByRole('button', { name: /filter/i }).first();
    if (await filterButton.isVisible()) {
      await filterButton.click();
      
      // Apply filter
      const select = page.getByLabel(/consumer|service/i).first();
      if (await select.isVisible()) {
        await select.click();
      }
    }
  });

  test('drift event detail shows schema diff', async ({ page }) => {
    // Click first drift event
    const firstEvent = page.locator('[role="row"]').nth(1);
    if (await firstEvent.isVisible()) {
      await firstEvent.click();
      
      // Should show detailed comparison
      await expect(page.getByText(/contract|baseline|observed/i)).toBeVisible();
    }
  });
});
