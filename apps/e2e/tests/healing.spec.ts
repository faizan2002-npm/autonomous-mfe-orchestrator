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

async function setShellMode(
  shell: Page,
  mode: 'Canary' | 'Sampled' | 'Baseline',
) {
  await shell.getByRole('radio', { name: mode }).click();
}

const profile = (shell: Page) =>
  shell.locator('section', { hasText: 'My profile' });

test.describe.configure({ mode: 'serial' });

test('signed-out visitors are sent to the login page and back afterwards', async ({
  page,
}) => {
  await page.goto(`${DASHBOARD}/o/demo/patches`);
  await expect(page).toHaveURL(/\/login\?next=%2Fo%2Fdemo%2Fpatches$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Create account' }),
  ).toBeVisible();
});

test('a new user onboards: organization, service, consumer key', async ({
  page,
}) => {
  await signIn(page);
  await page.goto(DASHBOARD);
  // No memberships yet, so the dashboard starts the onboarding wizard.
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel('Organization name').fill('E2E Corp');
  await expect(page.getByLabel('URL')).toHaveValue('e2e-corp');
  await page.getByRole('button', { name: 'Create organization' }).click();

  await page.getByLabel('Service name').fill('user-service');
  await page.getByLabel('Base URL').fill('http://localhost:3001');
  await page.getByRole('button', { name: 'Add service' }).click();
  await expect(page.getByText(/Reachable \(HTTP 200/)).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByLabel('Consumer name').fill('portal');
  await page.getByLabel('Allowed origins').fill('http://localhost:5100');
  await page.getByRole('button', { name: 'Create consumer and key' }).click();
  const key = await page.getByTestId('issued-key').textContent();
  expect(key).toMatch(/^pk_/);
  await page.getByRole('button', { name: "I've saved the key" }).click();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('button', { name: 'Open dashboard' }).click();
  await expect(page).toHaveURL(/\/o\/e2e-corp$/);

  // The key works through the gateway from an allowed origin.
  const response = await page.evaluate(async (apiKey) => {
    const result = await fetch(
      'http://localhost:4000/api/v1/user-service/users/101',
      {
        headers: { 'x-orchestrator-key': apiKey! },
      },
    );
    return result.status;
  }, key);
  expect(response).toBe(200);

  await page.getByRole('link', { name: 'Consumers & keys' }).click();
  await expect(page.getByText('portal')).toBeVisible();
  await expect(page.getByText(key!.slice(0, 10))).toBeVisible();
});

test('an invited owner joins the demo org; drift crashes a micro-frontend, the gateway heals it, a reviewer promotes', async ({
  page: dashboard,
  context,
}) => {
  await signIn(dashboard);
  const invite = process.env.E2E_OWNER_INVITE;
  expect(invite, 'seed must print an owner invitation').toBeTruthy();
  await dashboard.goto(invite!);
  await expect(
    dashboard.getByRole('heading', { name: 'Join Demo Organization' }),
  ).toBeVisible();
  await dashboard.getByRole('button', { name: 'Accept and join' }).click();
  await expect(dashboard).toHaveURL(/\/o\/demo$/);

  const shell = await context.newPage();
  // 1. Stable contract: the shell renders both remotes loaded via Module Federation.
  await shell.goto(SHELL);
  await setShellMode(shell, 'Baseline');
  await expect(profile(shell).getByText('Faizan Hussain')).toBeVisible();
  await expect(
    shell.locator('section', { hasText: 'Latest order' }).getByText('ORD-9821'),
  ).toBeVisible();

  // 2. Inject drift from the Demo Lab; the strict profile card now crashes.
  await dashboard.goto(`${DASHBOARD}/o/demo/demo`);
  await expect(dashboard.getByText('Live', { exact: true })).toBeVisible();
  await dashboard
    .getByRole('switch', { name: 'Inject drift into user-service' })
    .click();
  await expect(dashboard.getByText('Serving drifted schema')).toBeVisible();
  await expect(
    profile(shell).getByText('Micro-frontend crashed'),
  ).toBeVisible();

  // 3. A canary request (with the demo consumer's key) triggers detection, patching and canary deployment.
  await dashboard.getByRole('button', { name: 'Send request' }).click();
  await expect(dashboard.locator('li', { hasText: /^Step 3/ })).toHaveClass(
    /border-success/,
  );

  // 4. Canary traffic is healed; baseline traffic is not yet.
  await setShellMode(shell, 'Canary');
  await expect(
    profile(shell).getByText('Self-healed by gateway'),
  ).toBeVisible();
  await setShellMode(shell, 'Baseline');
  await expect(
    profile(shell).getByText('Micro-frontend crashed'),
  ).toBeVisible();

  // 5. The reviewer previews and promotes the patch.
  await dashboard.getByRole('link', { name: 'Review this patch →' }).click();
  await dashboard.getByRole('button', { name: 'Run preview' }).click();
  await expect(dashboard.getByText(/Contract restored in/)).toBeVisible();
  await dashboard.getByRole('button', { name: 'Promote' }).click();
  await dashboard
    .getByLabel('Review notes (optional)')
    .fill('Promoted by the Playwright e2e test');
  await dashboard
    .getByRole('dialog')
    .getByRole('button', { name: 'Promote' })
    .click();
  await expect(
    dashboard.getByText(/successfully promoted to 100% production/),
  ).toBeVisible();

  // 6. Every request is healed now, and the decision is audited under the signed-in reviewer.
  await expect(
    profile(shell).getByText('Self-healed by gateway'),
  ).toBeVisible();
  await dashboard.goto(`${DASHBOARD}/o/demo/audits`);
  const approval = dashboard.locator('tr', {
    hasText: 'Promoted by the Playwright e2e test',
  });
  await expect(approval).toContainText('Approved');
  await expect(approval).toContainText('e2e-reviewer@example.test');

  // 7. The org switcher lists both organizations.
  await dashboard.getByRole('button', { name: /Demo Organization/ }).click();
  await expect(
    dashboard.getByRole('menuitem', { name: 'E2E Corp' }),
  ).toBeVisible();
});
