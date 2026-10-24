// S8: the user revokes the reference app's consent in App access; the app's next request fails.
import { test, expect } from './fixtures.js';
import { URLS, appToken, clientId, expectAudit, hubApi } from './lib/stack.js';
import { allowConsent, appSignIn, connectOAuth, hubOpen } from './pages/hub.js';

test('S8: revoked consent -> next credential request fails', async ({ page, user }) => {
  const rp = clientId('sample-rp');
  await appSignIn(page, user);
  await hubOpen(page, user);
  const connectionId = await connectOAuth(page, user.id, { label: 'Revocable portal' });
  await page.goto(`${URLS.rp}/record?connectionId=${connectionId}`);
  await allowConsent(page, 'Sample RP');
  await page.waitForURL(`${URLS.rp}/connections`);

  await page.goto(`${URLS.hub}/apps`);
  await page.getByRole('button', { name: 'Revoke' }).click();
  await page.getByRole('button', { name: 'Confirm revoke' }).click();
  await expect(page.getByText('No apps have access to your connections.')).toBeVisible();
  expectAudit({ event: 'consent.revoke', sub: user.id, clientId: rp });

  await page.goto(`${URLS.rp}/record?connectionId=${connectionId}`);
  await page.waitForURL(`${URLS.hub}/consent?**`);
  const res = await hubApi('POST', '/v1/credentials', await appToken(user), { connectionId });
  expect([res.status, res.body.error.code]).toEqual([403, 'consent_required']);
});
