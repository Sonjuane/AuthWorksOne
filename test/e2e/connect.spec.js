// S4: connect HubSpot (mock, OAuth) and a WordPress site (mock, app password) in the Hub UI; both active.
import { test } from './fixtures.js';
import { connectOAuth, connectWordPress, expectStatus, hubOpen } from './pages/hub.js';

test('S4: HubSpot (mock) and WordPress (mock) connections show Active', async ({ page, user }) => {
  await hubOpen(page, user);
  await connectOAuth(page, user.id, { label: 'Main portal' });
  await connectWordPress(page, user.id, 'client-site.com');
  await expectStatus(page, 'Main portal', 'Active');
  await expectStatus(page, 'client-site.com', 'Active');
});
