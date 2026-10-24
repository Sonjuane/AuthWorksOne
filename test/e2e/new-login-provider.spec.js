// S18: a generic OIDC login provider declared only in config (test profile, applied by the setup's
// provision run) is on the sign-in page and signs a new user in (EX-01).
import { api } from '../../scripts/lib/logto.js';
import { test, expect } from './fixtures.js';
import { URLS, sso, testEmail } from './lib/stack.js';
import { logto } from './pages/logto.js';

test('S18: config-declared OIDC login providers show and sign a user in', async ({ page }) => {
  await page.goto(`${URLS.rp}/login`);
  for (const connector of sso.connectors.filter((c) => c.connectorId === 'oidc' && c.profiles?.includes('test'))) {
    await expect(page.getByRole('button', { name: `Continue with ${connector.metadata.name}` })).toBeVisible();
  }
  const email = testEmail('newidp');
  await logto.social(page, 'GitHub (mock)', email);
  await page.waitForURL(`${URLS.rp}/`);
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
  const [created] = (await api('GET', `/api/users?search=${encodeURIComponent(email)}`)).filter((u) => u.primaryEmail === email);
  expect(Object.keys(created.identities)).toEqual(['mock-github']);
});
