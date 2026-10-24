// Extra: "Forgot your password?" with the mailbox code; afterwards the old password is refused and
// the new one signs in.
import { test, expect } from './fixtures.js';
import { URLS } from './lib/stack.js';
import { logto } from './pages/logto.js';

test('password reset via mailbox code', async ({ page, user }) => {
  const newPassword = 'E2e!Reset-Passw0rd';
  await page.goto(`${URLS.rp}/login`);
  await logto.resetPassword(page, { email: user.email, newPassword });

  await page.locator('input[name=identifier]').fill(user.email);
  await page.locator('input[name=password]').fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText(/incorrect/i)).toBeVisible();

  await page.goto(`${URLS.rp}/login`);
  await logto.signIn(page, { email: user.email, password: newPassword });
  await page.waitForURL(`${URLS.rp}/`);
  await expect(page.getByText(`Signed in as ${user.email}`)).toBeVisible();
});
