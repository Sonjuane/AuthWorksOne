// Phase 5 integration tests: the public Hub API over HTTP (TV-01..TV-07, HA-03, HA-05) with real
// Logto tokens, consent rules, audit (AU-02/03), the Logto webhook (VA-08), and reconciliation.
// A second Hub process runs on :3996 as tenant `itest` with mock-pointed connectors; `hub-ui`'s
// client id stands in for the registered `second-client`, `profile-app` is unregistered.
// The real Logto -> compose Hub delivery test (S15) uses the running compose Hub (tenant default).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
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
import { loadOpenApi } from '../../apps/hub/core/manifest.js';
import { DEFAULT_AUTH_TYPE_DIRS, DEFAULT_CONNECTOR_DIRS, dirsFromEnv, loadRegistry } from '../../apps/hub/core/registry.js';
import { aadFor } from '../../apps/hub/core/sealed.js';
import { openApiValidator } from '../../apps/hub/core/schema.js';
import { createVault } from '../../apps/hub/core/vault.js';
import { createClient } from '../../scripts/lib/experience.js';
import { api } from '../../scripts/lib/logto.js';
import { contractFixtures } from '../contract/fixtures.js';
import { startMockProvider } from '../mock-provider/app.js';

const TENANT = 'itest';
const PORT = 3996;
const HUB = `http://localhost:${PORT}`;
const repo = new URL('../..', import.meta.url);
const sso = JSON.parse(readFileSync(new URL('config/sso.config.json', repo)));
const provider = await startMockProvider();
const { control } = provider;
const cleanups = [];
after(async () => { for (const fn of cleanups.reverse()) await fn().catch((err) => console.error('cleanup:', err.message)); });

// --- Fixture connectors: `hubspot` (allowed for both clients) and `acme` (allowed for neither) ---
const dir = mkdtempSync(join(tmpdir(), 'hub-api-connectors-'));
cleanups.push(async () => rmSync(dir, { recursive: true, force: true }));
const oauth = contractFixtures(provider).oauth2.definition;
writeFileSync(join(dir, 'hubspot.json'), JSON.stringify({ ...oauth, id: 'hubspot', name: 'HubSpot (mock)', env: { clientId: 'HUBSPOT_CLIENT_ID', clientSecret: 'HUBSPOT_CLIENT_SECRET' } }));
writeFileSync(join(dir, 'acme.json'), JSON.stringify({ ...oauth, id: 'acme', name: 'Acme', env: { clientId: 'ACME_CLIENT_ID', clientSecret: 'ACME_CLIENT_SECRET' } }));
const env = {
  ...process.env,
  HUB_PORT: String(PORT), HUB_BASE_URL: HUB, HUB_TENANT_ID: TENANT, HUB_ALLOW_PRIVATE_URLS: '1',
  HUB_CONNECTOR_DIRS: `apps/hub/connectors,${dir}`,
  HUBSPOT_CLIENT_ID: control.client.id, HUBSPOT_CLIENT_SECRET: control.client.secret,
  ACME_CLIENT_ID: control.client.id, ACME_CLIENT_SECRET: control.client.secret,
  SECOND_CLIENT_CLIENT_ID: process.env.HUB_UI_CLIENT_ID,
};

// --- Second Hub process ---
const hubLog = [];
const hub = spawn(process.execPath, ['apps/hub/server.js'], { cwd: repo, env });
hub.stdout.on('data', (chunk) => hubLog.push(String(chunk)));
hub.stderr.on('data', (chunk) => hubLog.push(String(chunk)));
cleanups.push(async () => { hub.kill(); await provider.close(); });
for (let i = 0; i < 50 && !(await fetch(`${HUB}/health`).then((r) => r.ok, () => false)); i++) await sleep(200);

// --- In-test services on the same database/tenant (to create connections and grants) ---
const config = loadConfig({ env });
const sql = connect(config.databaseUrl, { max: 4 });
cleanups.push(() => sql.end());
const registry = await loadRegistry({ authTypeDirs: dirsFromEnv(undefined, DEFAULT_AUTH_TYPE_DIRS), connectorDirs: [...dirsFromEnv(undefined, DEFAULT_CONNECTOR_DIRS), dir], env });
const vault = createVault({ keys: config.masterKeys, current: config.currentKeyVersion });
const audit = createAudit({ sql, tenantId: TENANT });
const connections = createConnections({ sql, vault, registry, tenantId: TENANT, http: createHttpClient({ allowPrivate: true }), baseUrl: HUB, audit, log: createLogger({ write: () => {} }) });
const consents = createConsents({ sql, tenantId: TENANT, clients: config.clients, registry, baseUrl: HUB, audit });

// --- Logto users and tokens ---
const newUser = async (tag) => {
  const password = `It!${randomBytes(9).toString('base64url')}9a`;
  const customData = Object.fromEntries(sso.customProfileFields.filter((f) => f.required).map((f) => [f.name, 'Integration']));
  const user = await api('POST', '/api/users', { primaryEmail: `it-api-${tag}-${Date.now()}@example.com`, password, customData });
  cleanups.push(async () => {
    await api('DELETE', `/api/users/${user.id}`).catch(() => {});
    await sql`delete from connections where tenant_id = ${TENANT} and sub = ${user.id}`;
  });
  return { ...user, password };
};
// Scripted client for a provisioned app (config `key` -> <KEY>_CLIENT_ID / _SECRET in .env.apps).
const app = (key) => {
  const prefix = key.replace(/-/g, '_').toUpperCase();
  const redirectUri = sso.applications.find((a) => a.key === key).redirectUris[0];
  return createClient({ clientId: process.env[`${prefix}_CLIENT_ID`], clientSecret: process.env[`${prefix}_CLIENT_SECRET`], redirectUri });
};
const clientsByName = { rp: app('sample-rp'), second: app('hub-ui'), unregistered: app('profile-app') };
const tokenFor = async (user, name, { resource = config.resource, scope = 'connections:read connections:token' } = {}) => {
  const client = clientsByName[name];
  const { tokens, error } = await client.signIn(user.primaryEmail, user.password, { scope: `openid offline_access ${scope}`, resource });
  assert.ok(tokens, `sign-in failed: ${error}`);
  return (await client.token({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, resource })).data.access_token;
};
const call = async (method, path, token, body) => {
  const res = await fetch(`${HUB}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};
const validate = openApiValidator(loadOpenApi());
const expectError = (res, status, code) => {
  assert.equal(validate('ErrorResponse', res.body), null, JSON.stringify(res.body));
  assert.deepEqual([res.status, res.body.error.code], [status, code], JSON.stringify(res.body));
};
const oauthConnect = async (sub, connectorId, label) => {
  const { redirectUrl } = await connections.startOAuth({ sub, connectorId, label });
  const callback = new URL((await fetch(redirectUrl, { redirect: 'manual' })).headers.get('location'));
  return (await connections.completeOAuth({ sub, query: callback.searchParams })).connection;
};

const user = await newUser('main');
const rpId = process.env.SAMPLE_RP_CLIENT_ID;
const rpReturn = sso.applications.find((a) => a.key === 'sample-rp').hub.consentReturnUris[0];
let rpToken;
let hubspot;

test('the second Hub started with the fixture connectors', () => {
  assert.match(hubLog.join(''), /"event":"started".*"connectors":\[[^\]]*"hubspot"/, hubLog.join('').slice(-2000));
});

test('token checks: missing, other audience, missing scope, unregistered client (S10, S11, HA-03, HA-05)', async () => {
  expectError(await call('GET', '/v1/connections'), 401, 'invalid_token');
  expectError(await call('GET', '/v1/connections', await tokenFor(user, 'rp', { resource: 'https://api.authworks.local', scope: 'read:sample' })), 401, 'invalid_token');
  expectError(await call('POST', '/v1/credentials', await tokenFor(user, 'rp', { scope: 'connections:read' }), { connectorId: 'hubspot' }), 403, 'insufficient_scope');
  expectError(await call('GET', '/v1/connections', await tokenFor(user, 'unregistered')), 403, 'client_not_registered');
});

test('no consent yet: empty list, consent_required with a consent URL (TV-01, TV-04, TV-06, S5)', async () => {
  rpToken = await tokenFor(user, 'rp');
  control.reset();
  hubspot = await oauthConnect(user.id, 'hubspot', 'My HubSpot portal');
  const list = await call('GET', '/v1/connections', rpToken);
  assert.equal(validate('ConnectionList', list.body), null);
  assert.deepEqual(list.body.data, []);
  const res = await call('POST', '/v1/credentials', rpToken, { connectorId: 'hubspot' });
  expectError(res, 403, 'consent_required');
  const url = new URL(res.body.error.consentUrl);
  assert.deepEqual([url.origin + url.pathname, url.searchParams.get('client_id'), url.searchParams.get('connector'), url.searchParams.get('return_to')], [`${HUB}/consent`, rpId, 'hubspot', rpReturn]);
  const byId = await call('POST', '/v1/credentials', rpToken, { connectionId: hubspot.id });
  expectError(byId, 403, 'consent_required');
  assert.equal(new URL(byId.body.error.consentUrl).searchParams.get('connection_id'), hubspot.id);
});

test('request validation and return URI rules (TV-02, TV-07, S11)', async () => {
  for (const body of [{}, { connectorId: 'hubspot', connectionId: hubspot.id }, { connectorId: 7 }, 'not json']) {
    expectError(await call('POST', '/v1/credentials', rpToken, body), 400, 'invalid_request');
  }
  expectError(await call('POST', '/v1/credentials', rpToken, { connectorId: 'hubspot', returnTo: 'https://evil.test/' }), 400, 'invalid_request');
  await assert.rejects(consents.grant({ sub: user.id, clientId: rpId, connectionId: hubspot.id, returnTo: 'https://evil.test/' }), (err) => err.code === 'invalid_request');
});

test('after consent: listed, credentials issued without refresh tokens, provider data fetched (TV-04, TV-05, S5, S14)', async () => {
  const { redirectTo } = await consents.grant({ sub: user.id, clientId: rpId, connectionId: hubspot.id });
  assert.equal(redirectTo, rpReturn);
  const list = await call('GET', '/v1/connections', rpToken);
  assert.deepEqual(list.body.data.map((c) => [c.id, c.connectorId, c.label, c.status]), [[hubspot.id, 'hubspot', 'My HubSpot portal', 'active']]);
  for (const body of [{ connectorId: 'hubspot' }, { connectionId: hubspot.id }]) {
    const res = await call('POST', '/v1/credentials', rpToken, body);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(validate('CredentialResponse', res.body), null);
    assert.equal(JSON.stringify(res.body).includes('mock_rt_'), false, 'no provider refresh token (S14)');
    const { secret, baseUrl, auth } = res.body.data;
    const records = await fetch(`${baseUrl}/api/records`, { headers: { [auth.header]: auth.format.replace('{{accessToken}}', secret.accessToken) } });
    assert.equal(records.status, 200);
  }
});

test('a second registered app needs its own consent (TV-01, S6)', async () => {
  const secondToken = await tokenFor(user, 'second');
  expectError(await call('POST', '/v1/credentials', secondToken, { connectionId: hubspot.id }), 403, 'consent_required');
  assert.deepEqual((await call('GET', '/v1/connections', secondToken)).body.data, []);
});

test('connector not allowed for the client; unknown connection (HA-05, TV-06)', async () => {
  const acme = await oauthConnect(user.id, 'acme', 'Acme');
  expectError(await call('POST', '/v1/credentials', rpToken, { connectionId: acme.id }), 403, 'connector_not_allowed_for_client');
  expectError(await call('POST', '/v1/credentials', rpToken, { connectorId: 'acme' }), 403, 'connector_not_allowed_for_client');
  expectError(await call('POST', '/v1/credentials', rpToken, { connectionId: randomUUID() }), 404, 'connection_not_found');
});

test('revoked consent blocks the next request (TV-03, S8)', async () => {
  const [grant] = (await consents.list(user.id)).filter((g) => g.app.clientId === rpId && g.connection.id === hubspot.id);
  await consents.revoke({ sub: user.id, grantId: grant.id });
  expectError(await call('POST', '/v1/credentials', rpToken, { connectionId: hubspot.id }), 403, 'consent_required');
  await consents.grant({ sub: user.id, clientId: rpId, connectionId: hubspot.id });
});

test('rejected refresh -> connection_reauth_required with a reconnect URL (VA-04, S7)', async () => {
  control.setExpiresIn(60);
  const expiring = await oauthConnect(user.id, 'hubspot', 'Expiring');
  await consents.grant({ sub: user.id, clientId: rpId, connectionId: expiring.id });
  control.setExpiresIn(3600);
  const refreshed = await call('POST', '/v1/credentials', rpToken, { connectionId: expiring.id });
  assert.equal(refreshed.status, 200, 'transparent refresh');
  control.expireAccessTokens();
  await sql`update connections set access_expires_at = now() where tenant_id = ${TENANT} and id = ${expiring.id}`;
  control.setFailRefresh(true);
  const res = await call('POST', '/v1/credentials', rpToken, { connectionId: expiring.id });
  expectError(res, 409, 'connection_reauth_required');
  assert.equal(res.body.error.reconnectUrl, `${HUB}/connect/start?connectionId=${expiring.id}`);
  control.setFailRefresh(false);
});

test('issued credentials and rejected calls are audited with caller details (AU-02, AU-03)', async () => {
  const rows = await sql`select event_type, result, client_id, error_code, ip, detail from audit_log where tenant_id = ${TENANT} and sub = ${user.id}`;
  const events = new Set(rows.map((r) => `${r.event_type}:${r.error_code ?? ''}`));
  for (const expected of ['credential.issue:', 'api.reject:consent_required', 'api.reject:connector_not_allowed_for_client', 'api.reject:insufficient_scope', 'api.reject:client_not_registered', 'consent.grant:', 'consent.revoke:', 'connection.refresh_failure:refresh_failed']) {
    assert.ok(events.has(expected), `missing ${expected}; have ${[...events].join(', ')}`);
  }
  const issued = rows.find((r) => r.event_type === 'credential.issue');
  assert.equal(issued.client_id, rpId);
  assert.ok(issued.ip);
});

test('webhook: bad signature refused; signed User.Deleted removes connections and consents (VA-08)', async () => {
  const doomed = await newUser('webhook');
  const connection = await oauthConnect(doomed.id, 'hubspot', 'Doomed');
  await consents.grant({ sub: doomed.id, clientId: rpId, connectionId: connection.id });
  const body = JSON.stringify({ event: 'User.Deleted', user: { id: doomed.id }, params: { userId: doomed.id } });
  const post = (signature) => fetch(`${HUB}/webhooks/logto`, { method: 'POST', headers: { 'content-type': 'application/json', 'logto-signature-sha-256': signature }, body });
  assert.equal((await post('0'.repeat(64))).status, 401);
  assert.equal((await sql`select 1 from connections where tenant_id = ${TENANT} and sub = ${doomed.id}`).length, 1);
  const res = await post(createHmac('sha256', process.env.HUB_WEBHOOK_SIGNING_KEY).update(body).digest('hex'));
  assert.deepEqual(await res.json().then((j) => j.data), { sub: doomed.id, connections: 1 });
  assert.equal((await sql`select 1 from connections where tenant_id = ${TENANT} and sub = ${doomed.id}`).length, 0);
  assert.equal((await sql`select 1 from consent_grants where tenant_id = ${TENANT} and sub = ${doomed.id}`).length, 0);
  assert.equal(control.calls()['POST /oauth/revoke'] > 0, true, 'provider revoke attempted');
});

test('deleting a user in Logto removes their Hub data through the real webhook (S15)', { skip: !(await fetch('http://localhost:3030/health').then((r) => r.ok, () => false)) && 'compose Hub not running' }, async () => {
  const doomed = await newUser('s15');
  const main = loadConfig();
  const connectionId = randomUUID();
  await sql`insert into connections (tenant_id, id, sub, connector_id, label, status) values (${main.tenantId}, ${connectionId}, ${doomed.id}, 'wordpress', 'S15', 'active')`;
  await sql`insert into connection_secrets (tenant_id, connection_id, key_version, sealed)
            values (${main.tenantId}, ${connectionId}, ${vault.current}, ${vault.seal({ kind: 'app_password', username: 'u', password: 'p' }, aadFor(main.tenantId, 'connection_secrets', connectionId))})`;
  await sql`insert into consent_grants (tenant_id, sub, client_id, connection_id) values (${main.tenantId}, ${doomed.id}, ${rpId}, ${connectionId})`;
  cleanups.push(() => sql`delete from connections where tenant_id = ${main.tenantId} and id = ${connectionId}`);
  await api('DELETE', `/api/users/${doomed.id}`);
  let remaining = 1;
  for (let i = 0; i < 50 && remaining; i++) {
    await sleep(200);
    remaining = (await sql`select 1 from connections where tenant_id = ${main.tenantId} and id = ${connectionId}`).length;
  }
  assert.equal(remaining, 0, 'Logto delivered User.Deleted and the Hub purged the connection');
  assert.equal((await sql`select 1 from consent_grants where tenant_id = ${main.tenantId} and sub = ${doomed.id}`).length, 0);
});

test('hub:reconcile removes data of users missing from Logto (dry run first) (VA-08 backstop)', async () => {
  const orphan = await newUser('orphan');
  await oauthConnect(orphan.id, 'hubspot', 'Orphaned');
  // Delete in Logto; the compose Hub (tenant default) gets the webhook, so the itest rows stay.
  await api('DELETE', `/api/users/${orphan.id}`);
  const run = (...args) => promisify(execFile)(process.execPath, ['--env-file=.env', '--env-file=.env.apps', 'scripts/hub-reconcile.js', ...args], { cwd: repo, env: { ...env, HUB_PORT: '' } });
  const dry = await run('--dry-run');
  assert.match(dry.stdout, new RegExp(`- would remove ${orphan.id}: 1 connection`));
  assert.equal((await sql`select 1 from connections where tenant_id = ${TENANT} and sub = ${orphan.id}`).length, 1);
  const real = await run();
  assert.match(real.stdout, new RegExp(`\\+ removed ${orphan.id}: 1 connection`));
  assert.equal((await sql`select 1 from connections where tenant_id = ${TENANT} and sub = ${orphan.id}`).length, 0);
  assert.doesNotMatch(real.stdout, new RegExp(user.id), 'existing users untouched');
});

test('the Hub process logged no tokens or secrets (VA-07, S13)', () => {
  const text = hubLog.join('');
  assert.equal(/mock_[ar]t_|mock-secret/.test(text), false);
  assert.equal(text.includes(process.env.HUB_WEBHOOK_SIGNING_KEY), false);
});
