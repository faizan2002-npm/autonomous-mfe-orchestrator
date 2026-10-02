import { expect, test, type Page } from '@playwright/test';

const DASHBOARD = 'http://localhost:5100';
const SHELL = 'http://localhost:5000';
const AUTH = 'http://localhost:54399';
// supabase-js stores the session under sb-<first label of the Supabase host>-auth-token.
const SESSION_KEY = 'sb-localhost-auth-token';

/** Signs the dashboard in with a session issued by the local stand-in for Supabase Auth. */
async function signIn(page: Page) {
  const session = await (await fetch(`${AUTH}/__e2e/session`)).json();
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [SESSION_KEY, JSON.stringify(session)] as const,
  );
}

async function setShellMode(shell: Page, mode: 'Canary' | 'Sampled' | 'Baseline') {
  await shell.getByRole('radio', { name: mode }).click();
}

const profile = (shell: Page) => shell.locator('section', { hasText: 'My profile' });

test('signed-out visitors are sent to the login page', async ({ page }) => {
  await page.goto(`${DASHBOARD}/patches`);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('Governance Console')).toBeVisible();
});

test('drift crashes a micro-frontend, the gateway heals it, and a reviewer promotes the fix', async ({
  page: dashboard,
  context,
}) => {
  await signIn(dashboard);
  const shell = await context.newPage();

  // 1. Stable contract: the shell renders both remotes loaded via Module Federation.
  await shell.goto(SHELL);
  await setShellMode(shell, 'Baseline');
  await expect(profile(shell).getByText('Faizan Hussain')).toBeVisible();
  await expect(shell.locator('section', { hasText: 'Latest order' }).getByText('ORD-9821')).toBeVisible();

  // 2. Inject drift from the Demo Lab; the strict profile card now crashes.
  await dashboard.goto(`${DASHBOARD}/demo`);
  await expect(dashboard.getByText('Live', { exact: true })).toBeVisible();
  await dashboard.getByRole('switch', { name: 'Inject drift into user-service' }).click();
  await expect(dashboard.getByText('Serving drifted schema')).toBeVisible();
  await expect(profile(shell).getByText('Micro-frontend crashed')).toBeVisible();

  // 3. A canary request triggers detection, patch generation and canary deployment.
  await dashboard.getByRole('button', { name: 'Send request' }).click();
  const pipeline = dashboard.locator('li', { hasText: /^Step 3/ });
  await expect(pipeline).toHaveClass(/border-success/);

  // 4. Canary traffic is healed; baseline traffic is not yet.
  await setShellMode(shell, 'Canary');
  await expect(profile(shell).getByText('Self-healed by gateway')).toBeVisible();
  await setShellMode(shell, 'Baseline');
  await expect(profile(shell).getByText('Micro-frontend crashed')).toBeVisible();

  // 5. The reviewer previews and promotes the patch.
  await dashboard.getByRole('link', { name: 'Review this patch →' }).click();
  await dashboard.getByRole('button', { name: 'Run preview' }).click();
  await expect(dashboard.getByText(/Contract restored in/)).toBeVisible();
  await dashboard.getByRole('button', { name: 'Promote' }).click();
  await dashboard.getByLabel('Review notes (optional)').fill('Promoted by the Playwright e2e test');
  await dashboard.getByRole('dialog').getByRole('button', { name: 'Promote' }).click();
  await expect(dashboard.getByText(/successfully promoted to 100% production/)).toBeVisible();

  // 6. Now every request is healed, and the decision is audited under the signed-in reviewer.
  await expect(profile(shell).getByText('Self-healed by gateway')).toBeVisible();
  await dashboard.goto(`${DASHBOARD}/audits`);
  const approval = dashboard.locator('tr', { hasText: 'Promoted by the Playwright e2e test' });
  await expect(approval).toContainText('Approved');
  await expect(approval).toContainText('e2e-reviewer@example.test');
});
