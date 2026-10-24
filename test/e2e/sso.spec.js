// S3: signed in to the reference app, opening the Hub UI signs in silently (no Logto sign-in page).
import { test, expect } from './fixtures.js';
import { URLS } from './lib/stack.js';
import { appSignIn } from './pages/hub.js';

test('S3: reference app sign-in, then the Hub UI signs in silently (SSO)', async ({ page, user }) => {
  await appSignIn(page, user);
  const visited = [];
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) visited.push(new URL(frame.url())); });
  await page.goto(`${URLS.hub}/`);
  await page.waitForURL(`${URLS.hub}/connections`);
  await expect(page.getByText(user.email)).toBeVisible();
  expect(visited.filter((url) => url.origin === URLS.logto && url.pathname.startsWith('/sign-in'))).toEqual([]);
});
