// Extra (ID-04): a user with TOTP switches 2-step verification off in Account Center; the next
// sign-in asks for the password only.
import { api } from '../../scripts/lib/logto.js';
import { test, expect } from './fixtures.js';
import { URLS } from './lib/stack.js';
import { appSignIn } from './pages/hub.js';
import { logto } from './pages/logto.js';

test('2FA removal in Account Center', async ({ page, user }) => {
  const totpSecret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
  await api('POST', `/api/users/${user.id}/mfa-verifications`, { type: 'Totp', secret: totpSecret });
  await page.goto(`${URLS.rp}/login`);
  await logto.signIn(page, { ...user, totpSecret });
  await page.waitForURL(`${URLS.rp}/`);

  await logto.disableMfa(page, user.password);
  await page.goto(`${URLS.rp}/logout`);
  await page.waitForURL(`${URLS.rp}/`);

  const visited = [];
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) visited.push(new URL(frame.url()).pathname); });
  await appSignIn(page, user);
  expect(visited.filter((path) => path.startsWith('/mfa-verification'))).toEqual([]);
});
