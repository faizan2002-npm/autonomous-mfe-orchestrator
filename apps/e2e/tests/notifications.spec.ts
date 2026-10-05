import { test, expect } from '@playwright/test';

test.describe('Notifications and Inbox', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/o/demo');
  });

  test('bell icon shows unread count', async ({ page }) => {
    const bell = page.getByRole('button', { name: /notifications|inbox|bell/i });
    await expect(bell).toBeVisible();
    
    // Badge should show count
    const badge = bell.locator('span[class*="badge"]');
    await expect(badge).toBeVisible({ timeout: 5000 });
  });

  test('can open and read notifications', async ({ page }) => {
    const bell = page.getByRole('button', { name: /notifications|inbox|bell/i });
    await bell.click();

    // Inbox should show
    await expect(page.getByRole('heading', { name: /inbox/i })).toBeVisible();
    await expect(page.getByText(/notification|message/i)).toBeVisible();
  });

  test('can navigate to notification details', async ({ page }) => {
    const bell = page.getByRole('button', { name: /notifications|inbox|bell/i });
    await bell.click();

    // Click first notification
    const notification = page.getByRole('button', { name: /patch|drift|alert/i }).first();
    if (await notification.isVisible()) {
      await notification.click();
      // Should navigate to relevant page (patch, service, etc.)
    }
  });

  test('notification settings tab shows preferences', async ({ page }) => {
    await page.goto('/o/demo/settings');
    const notificationsTab = page.getByRole('tab', { name: /notifications/i });
    
    if (await notificationsTab.isVisible()) {
      await notificationsTab.click();
      
      // Should show channel preferences matrix
      await expect(page.getByText(/email|push|slack/i)).toBeVisible();
    }
  });

  test('can enable/disable push notifications on device', async ({ page, context }) => {
    await page.goto('/o/demo/settings');
    const notificationsTab = page.getByRole('tab', { name: /notifications/i });
    
    if (await notificationsTab.isVisible()) {
      await notificationsTab.click();

      const enableButton = page.getByRole('button', { name: /enable push|subscribe/i });
      if (await enableButton.isVisible()) {
        // Grant notification permission
        await context.grantPermissions(['notifications']);
        await enableButton.click();
        
        await expect(page.getByText(/enabled|subscribed/i)).toBeVisible();
      }
    }
  });
});
