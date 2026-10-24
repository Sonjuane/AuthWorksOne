// S17: a new oauth2 connector definition (pointed at the mock) works end to end with no code change:
// drop one JSON file into a connector directory, restart the Hub, connect it in the UI (CN-04).
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from './fixtures.js';
import { compose, repo, runtime, URLS, waitFor } from './lib/stack.js';
import { connectOAuth, hubOpen } from './pages/hub.js';

test('S17: dropped-in oauth2 connector connects with no code change', async ({ page, user }) => {
  const template = JSON.parse(readFileSync(new URL('test/fixtures/connectors/acme.json', repo)));
  writeFileSync(new URL('connectors/e2e-crm.json', runtime), JSON.stringify({ ...template, id: 'e2e-crm', name: 'E2E CRM' }));
  compose('restart', 'hub');
  await waitFor(`${URLS.hub}/health`);

  await hubOpen(page, user);
  await connectOAuth(page, user.id, { service: 'E2E CRM', label: 'New CRM' });
});
