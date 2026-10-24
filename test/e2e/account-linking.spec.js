// S2: mock "Google" then mock "GitHub" with the same verified email resolve to one Logto user (ID-03).
import { api } from '../../scripts/lib/logto.js';
import { test, expect } from './fixtures.js';
import { URLS, testEmail } from './lib/stack.js';
import { logto } from './pages/logto.js';

test('S2: Google (mock) then GitHub (mock) with one email -> one user with both identities', async ({ page }) => {
  const email = testEmail('linking');
  await page.goto(`${URLS.rp}/login`);
  await logto.social(page, 'Google (mock)', email);
  await page.waitForURL(`${URLS.rp}/`);
  await page.goto(`${URLS.rp}/logout`);
  await page.waitForURL(`${URLS.rp}/`);

  await page.goto(`${URLS.rp}/login`);
  await logto.social(page, 'GitHub (mock)', email);
  await page.waitForURL(`${URLS.rp}/`);
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();

  const users = (await api('GET', `/api/users?search=${encodeURIComponent(email)}`)).filter((u) => u.primaryEmail === email);
  expect(users).toHaveLength(1);
  expect(Object.keys(users[0].identities).sort()).toEqual(['mock-github', 'mock-google']);
});
