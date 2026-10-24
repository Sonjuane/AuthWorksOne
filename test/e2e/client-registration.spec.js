// S11: a client ID not in Hub config gets client_not_registered; a consent return URI that is not in
// the app's consentReturnUris is refused on the consent page.
import { api } from '../../scripts/lib/logto.js';
import { test, expect } from './fixtures.js';
import { URLS, appToken, clientId, expectAudit, hubApi } from './lib/stack.js';
import { hubOpen } from './pages/hub.js';

test('S11: unregistered client -> client_not_registered', async ({ user }) => {
  const app = await api('POST', '/api/applications', {
    name: `e2e-unregistered-${Date.now()}`, type: 'Traditional',
    oidcClientMetadata: { redirectUris: ['http://localhost:3999/callback'], postLogoutRedirectUris: [] },
  });
  try {
    const [secret] = await api('GET', `/api/applications/${app.id}/secrets`);
    const token = await appToken(user, { key: 'unregistered', id: app.id, secret: secret.value });
    const res = await hubApi('GET', '/v1/connections', token);
    expect([res.status, res.body.error.code]).toEqual([403, 'client_not_registered']);
    expectAudit({ event: 'api.reject', sub: user.id, clientId: app.id, errorCode: 'client_not_registered' });
  } finally {
    await api('DELETE', `/api/applications/${app.id}`);
  }
});

test('S11: unregistered consent return URI is refused', async ({ page, user }) => {
  await hubOpen(page, user);
  await page.goto(`${URLS.hub}/consent?client_id=${clientId('sample-rp')}&connector=hubspot&return_to=${encodeURIComponent('https://evil.example/steal')}`);
  await expect(page.getByText(/registered consent return URIs/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Allow' })).toHaveCount(0);
  expect(new URL(page.url()).origin).toBe(URLS.hub);
});
