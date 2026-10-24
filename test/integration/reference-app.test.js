// Phase 7 integration tests: the reference client app (apps/sample-rp) as a real process, signed in
// through Logto, against a test Hub (:3995, tenant `itest`) and the in-process mock provider.
// Covers the roles view (ID-07), S5 (consent_required -> consent -> credentials -> one record per
// connector), S6 (the second client still needs its own consent), and the reconnectUrl redirect.
// The consent click itself is a service call here; the Hub consent page has its own tests.
// The RPs listen on their configured ports (3010, 3011), so `npm run rp` must not be running.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createAudit } from '../../apps/hub/core/audit.js';
import { loadConfig } from '../../apps/hub/core/config.js';
import { createConnections } from '../../apps/hub/core/connections.js';
import { createConsents } from '../../apps/hub/core/consent.js';
import { connect } from '../../apps/hub/core/db.js';
import { createHttpClient } from '../../apps/hub/core/http-client.js';
import { createLogger } from '../../apps/hub/core/log.js';
import { DEFAULT_AUTH_TYPE_DIRS, DEFAULT_CONNECTOR_DIRS, dirsFromEnv, loadRegistry } from '../../apps/hub/core/registry.js';
import { createVault } from '../../apps/hub/core/vault.js';
import { appSignIn } from '../../scripts/lib/experience.js';
import { api } from '../../scripts/lib/logto.js';
import { contractFixtures } from '../contract/fixtures.js';
import { startMockProvider } from '../mock-provider/app.js';

const TENANT = 'itest';
const HUB = 'http://localhost:3995';
const repo = new URL('../..', import.meta.url);
const sso = JSON.parse(readFileSync(new URL('config/sso.config.json', repo)));
const rpApp = sso.applications.find((a) => a.key === 'sample-rp');
const secondApp = sso.applications.find((a) => a.key === 'second-client');
const provider = await startMockProvider();
const { control } = provider;
const cleanups = [];
after(async () => { for (const fn of cleanups.reverse()) await fn().catch((err) => console.error('cleanup:', err.message)); });
cleanups.push(() => provider.close());

const up = (url) => fetch(url).then((r) => r.status < 500, () => false);
const waitUp = async (url) => {
  for (let i = 0; i < 50 && !(await up(url)); i++) await sleep(200);
  assert.ok(await up(url), `${url} did not start`);
};
const run = (args, env) => {
  const log = [];
  const child = spawn(process.execPath, args, { cwd: repo, env });
  child.stdout.on('data', (chunk) => log.push(String(chunk)));
  child.stderr.on('data', (chunk) => log.push(String(chunk)));
  cleanups.push(async () => child.kill());
  return log;
};

// --- Test Hub with a mock-pointed `hubspot`; `wordpress` is the real definition (site = mock) ---
const dir = mkdtempSync(join(tmpdir(), 'reference-app-connectors-'));
cleanups.push(async () => rmSync(dir, { recursive: true, force: true }));
const oauth = contractFixtures(provider).oauth2.definition;
writeFileSync(join(dir, 'hubspot.json'), JSON.stringify({ ...oauth, id: 'hubspot', name: 'HubSpot (mock)', env: { clientId: 'HUBSPOT_CLIENT_ID', clientSecret: 'HUBSPOT_CLIENT_SECRET' } }));
const env = {
  ...process.env,
  HUB_PORT: '3995', HUB_BASE_URL: HUB, HUB_TENANT_ID: TENANT, HUB_ALLOW_PRIVATE_URLS: '1',
  HUB_CONNECTOR_DIRS: `apps/hub/connectors,${dir}`,
  HUBSPOT_CLIENT_ID: control.client.id, HUBSPOT_CLIENT_SECRET: control.client.secret,
};
for (const a of [rpApp, secondApp]) assert.ok(!(await up(a.baseUrl)), `${a.baseUrl} is already in use; stop it first`);
run(['apps/hub/server.js'], env);
await waitUp(`${HUB}/health`);
run(['apps/sample-rp/server.js'], { ...process.env, HUB_URL: HUB });
run(['apps/sample-rp/server.js'], { ...process.env, HUB_URL: HUB, APP_KEY: 'second-client' });
await Promise.all([waitUp(rpApp.baseUrl), waitUp(secondApp.baseUrl)]);

// --- In-test services on the same database/tenant (to create connections and grants) ---
const config = loadConfig({ env });
const sql = connect(config.databaseUrl, { max: 4 });
cleanups.push(() => sql.end());
const registry = await loadRegistry({ authTypeDirs: dirsFromEnv(undefined, DEFAULT_AUTH_TYPE_DIRS), connectorDirs: [...dirsFromEnv(undefined, DEFAULT_CONNECTOR_DIRS), dir], env });
const vault = createVault({ keys: config.masterKeys, current: config.currentKeyVersion });
const audit = createAudit({ sql, tenantId: TENANT });
const connections = createConnections({ sql, vault, registry, tenantId: TENANT, http: createHttpClient({ allowPrivate: true }), baseUrl: HUB, audit, log: createLogger({ write: () => {} }) });
const consents = createConsents({ sql, tenantId: TENANT, clients: config.clients, registry, baseUrl: HUB, audit });
const oauthConnect = async (sub, label) => {
  const { redirectUrl } = await connections.startOAuth({ sub, connectorId: 'hubspot', label });
  const callback = new URL((await fetch(redirectUrl, { redirect: 'manual' })).headers.get('location'));
  return (await connections.completeOAuth({ sub, query: callback.searchParams })).connection;
};

// --- One Logto user, signed in to both apps (the second sign-in is silent SSO) ---
const password = `It!${randomBytes(9).toString('base64url')}9a`;
const customData = Object.fromEntries(sso.customProfileFields.filter((f) => f.required).map((f) => [f.name, 'Integration']));
const user = await api('POST', '/api/users', { primaryEmail: `it-rp-${Date.now()}@example.com`, password, customData });
cleanups.push(async () => {
  await api('DELETE', `/api/users/${user.id}`).catch(() => {});
  await sql`delete from connections where tenant_id = ${TENANT} and sub = ${user.id}`;
});
const { app: rp, logto } = await appSignIn({ appUrl: rpApp.baseUrl, email: user.primaryEmail, password });
const { app: second } = await appSignIn({ appUrl: secondApp.baseUrl, email: user.primaryEmail, password, logto });

const rpId = process.env.SAMPLE_RP_CLIENT_ID;
const rpReturn = rpApp.hub.consentReturnUris[0];
const consentTarget = (location) => {
  const url = new URL(location);
  assert.equal(`${url.origin}${url.pathname}`, `${HUB}/consent`);
  return Object.fromEntries(url.searchParams);
};
const assertNoSecrets = (html) => assert.doesNotMatch(html, /mock_at_|mock_rt_|abcdefghijklmnop/);

test('roles view shows role and permissions from the resource JWT (ID-07, Deliverable 3)', async () => {
  const home = await rp('GET', '/');
  assert.equal(home.status, 200);
  assert.match(home.data, /<td>roles<\/td><td>[^<]*\buser\b/);
  assert.match(home.data, /read:sample/);
});

let hubspot;
test('S5: consent_required -> consentUrl, consent, then credentials and one record per connector', async () => {
  hubspot = await oauthConnect(user.id, 'Main portal');
  control.addAppPassword('admin', 'abcd efgh ijkl mnop');
  const wordpress = await connections.createFromInput({ sub: user.id, connectorId: 'wordpress', label: 'client-site.com', input: { siteUrl: provider.url, username: 'admin', appPassword: 'abcd efgh ijkl mnop' } });

  assert.match((await rp('GET', '/connections')).data, /No connections allowed yet/);
  const first = await rp('GET', '/record?connectorId=hubspot');
  assert.equal(first.status, 302);
  assert.deepEqual(consentTarget(first.location), { client_id: rpId, connector: 'hubspot', return_to: rpReturn });

  // The user allows the app on the Hub consent page, which returns them to the app.
  const { redirectTo } = await consents.grant({ sub: user.id, clientId: rpId, connectionId: hubspot.id, returnTo: rpReturn });
  assert.equal(redirectTo, rpReturn);
  const listed = await rp('GET', new URL(rpReturn).pathname);
  assert.match(listed.data, /Main portal/);
  assert.match(listed.data, new RegExp(`/record\\?connectionId=${hubspot.id}`));

  const record = await rp('GET', '/record?connectorId=hubspot');
  assert.equal(record.status, 200, record.data);
  assert.match(record.data, /contact@example\.com/);
  assertNoSecrets(record.data);

  await consents.grant({ sub: user.id, clientId: rpId, connectionId: wordpress.id, returnTo: rpReturn });
  const post = await rp('GET', `/record?connectionId=${wordpress.id}`);
  assert.equal(post.status, 200, post.data);
  assert.match(post.data, /Hello world/);
  assertNoSecrets(post.data);
});

test('S6: the second client gets consent_required for the same connection (TV-01)', async () => {
  assert.match((await second('GET', '/connections')).data, /No connections allowed yet/);
  const res = await second('GET', `/record?connectionId=${hubspot.id}`);
  assert.equal(res.status, 302);
  assert.deepEqual(consentTarget(res.location), {
    client_id: process.env.SECOND_CLIENT_CLIENT_ID,
    connection_id: hubspot.id,
    return_to: secondApp.hub.consentReturnUris[0],
  });
});

test('connection_reauth_required sends the user to the reconnectUrl', async () => {
  control.setExpiresIn(60);
  const expiring = await oauthConnect(user.id, 'Expiring portal');
  await consents.grant({ sub: user.id, clientId: rpId, connectionId: expiring.id, returnTo: rpReturn });
  control.setFailRefresh(true);
  const res = await rp('GET', `/record?connectionId=${expiring.id}`);
  assert.equal(res.status, 302);
  assert.equal(res.location, `${HUB}/connect/start?connectionId=${expiring.id}`);
});
