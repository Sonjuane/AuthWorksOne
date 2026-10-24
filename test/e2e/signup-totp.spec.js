// S1: email/password sign-up with the mailbox code, TOTP enrollment, logout, password + TOTP sign-in.
import { test, expect } from './fixtures.js';
import { URLS, testEmail } from './lib/stack.js';
import { logto } from './pages/logto.js';

test('S1: sign up, enroll TOTP, log out, log back in with password + TOTP', async ({ page }) => {
  const email = testEmail('signup');
  const password = 'E2e!Signup-Passw0rd';
  await page.goto(`${URLS.rp}/login`);
  const { totpSecret } = await logto.signUp(page, { email, password, enrollTotp: true });
  await page.waitForURL(`${URLS.rp}/`);
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();

  await page.getByRole('link', { name: 'SSO logout' }).click();
  await expect(page.getByRole('link', { name: 'Sign in via SSO' })).toBeVisible();

  await page.goto(`${URLS.rp}/login`);
  await logto.signIn(page, { email, password, totpSecret });
  await page.waitForURL(`${URLS.rp}/`);
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
});
