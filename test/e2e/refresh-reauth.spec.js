// S7: a token near expiry is refreshed transparently; when the provider then rejects the refresh, the
// connection becomes needs_reauth and the API returns connection_reauth_required; reconnect fixes it.
import { test, expect } from './fixtures.js';
import { URLS, appToken, control, expectAudit, hubApi } from './lib/stack.js';
import { allowConsent, appSignIn, connectOAuth, expectStatus, hubOpen } from './pages/hub.js';

test.afterEach(() => control('reset'));

test('S7: transparent refresh, then refresh failure -> needs_reauth -> reconnect', async ({ page, user }) => {
  await control('expires-in', { seconds: 60 }); // inside the Hub's 5-minute refresh window
  await appSignIn(page, user);
  await hubOpen(page, user);
  const connectionId = await connectOAuth(page, user.id, { label: 'Expiring portal' });
  await page.goto(`${URLS.rp}/record?connectionId=${connectionId}`);
  await allowConsent(page, 'Sample RP');
  await page.waitForURL(`${URLS.rp}/connections`);

  const tokenCalls = async () => (await control('calls'))['POST /oauth/token'] ?? 0;
  const before = await tokenCalls();
  await page.goto(`${URLS.rp}/record?connectionId=${connectionId}`);
  await expect(page.getByText('contact@example.com')).toBeVisible();
  expect(await tokenCalls()).toBeGreaterThan(before);

  await control('fail-refresh', { value: true });
  const res = await hubApi('POST', '/v1/credentials', await appToken(user), { connectionId });
  expect([res.status, res.body.error.code]).toEqual([409, 'connection_reauth_required']);
  expect(res.body.error.reconnectUrl).toBe(`${URLS.hub}/connect/start?connectionId=${connectionId}`);
  expectAudit({ event: 'connection.refresh_failure', sub: user.id });

  await page.goto(`${URLS.hub}/connections`);
  await expectStatus(page, 'Expiring portal', 'Needs reconnect');
  await page.getByRole('button', { name: 'Reconnect' }).click();
  await page.waitForURL(`${URLS.hub}/connections?**`);
  await expectStatus(page, 'Expiring portal', 'Active');
  expectAudit({ event: 'connection.reconnect', sub: user.id });
});
