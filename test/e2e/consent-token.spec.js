// S5: the reference app asks for HubSpot credentials, gets consent_required, the user consents, and the
// app gets an access token and fetches a record (also checked directly against the Hub API).
import { test, expect } from './fixtures.js';
import { URLS, appToken, clientId, expectAudit, hubApi } from './lib/stack.js';
import { allowConsent, appSignIn, connectOAuth, hubOpen } from './pages/hub.js';

test('S5: consent_required -> consent -> credentials -> one record', async ({ page, user }) => {
  const rp = clientId('sample-rp');
  await appSignIn(page, user);
  await hubOpen(page, user);
  await connectOAuth(page, user.id, { label: 'Sales portal' });

  await page.goto(`${URLS.rp}/record?connectorId=hubspot`);
  await allowConsent(page, 'Sample RP');
  await page.waitForURL(`${URLS.rp}/connections`);
  await expect(page.getByRole('cell', { name: 'Sales portal' })).toBeVisible();
  expectAudit({ event: 'api.reject', sub: user.id, clientId: rp, errorCode: 'consent_required' });
  expectAudit({ event: 'consent.grant', sub: user.id, clientId: rp });

  await page.getByRole('link', { name: 'Fetch a record' }).click();
  await expect(page.getByText('contact@example.com')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('mock_at_');
  expectAudit({ event: 'credential.issue', sub: user.id, clientId: rp });

  const res = await hubApi('POST', '/v1/credentials', await appToken(user), { connectorId: 'hubspot' });
  expect(res.status).toBe(200);
  expect(res.body.data).toMatchObject({ connectorId: 'hubspot', authType: 'oauth2', auth: { header: 'Authorization' } });
  expect(res.body.data.secret.accessToken).toMatch(/^mock_at_/);
});
