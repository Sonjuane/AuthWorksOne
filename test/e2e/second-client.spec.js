// S6: after consenting for the reference app, a second registered client asking for the same
// connection still gets consent_required (TV-01: consent is per client_id).
import { test, expect } from './fixtures.js';
import { URLS, appToken, clientId, expectAudit, hubApi } from './lib/stack.js';
import { allowConsent, appSignIn, connectOAuth, hubOpen } from './pages/hub.js';

test('S6: the second client needs its own consent', async ({ page, user }) => {
  await appSignIn(page, user);
  await hubOpen(page, user);
  const connectionId = await connectOAuth(page, user.id, { label: 'Shared portal' });
  await page.goto(`${URLS.rp}/record?connectorId=hubspot`);
  await allowConsent(page, 'Sample RP');
  await page.waitForURL(`${URLS.rp}/connections`);

  await appSignIn(page, user, URLS.second);
  await page.goto(`${URLS.second}/record?connectionId=${connectionId}`);
  await page.waitForURL(`${URLS.hub}/consent?**`);
  await expect(page.getByRole('heading', { name: 'Allow Second Client?' })).toBeVisible();

  const second = clientId('second-client');
  const res = await hubApi('POST', '/v1/credentials', await appToken(user, { key: 'second-client' }), { connectionId });
  expect([res.status, res.body.error.code]).toEqual([403, 'consent_required']);
  expect(new URL(res.body.error.consentUrl).searchParams.get('client_id')).toBe(second);
  expectAudit({ event: 'api.reject', sub: user.id, clientId: second, errorCode: 'consent_required' });
});
