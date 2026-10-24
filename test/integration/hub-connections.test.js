// Phase 4 integration tests: the connection service against the real Hub database and an
// in-process mock provider. Rows use tenant_id `itest` (audit rows are append-only and stay,
// separated from the `default` tenant); connections are deleted afterwards.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiError } from '../../apps/hub/core/auth.js';
import { createAudit } from '../../apps/hub/core/audit.js';
import { loadConfig } from '../../apps/hub/core/config.js';
import { createConnections } from '../../apps/hub/core/connections.js';
import { connect } from '../../apps/hub/core/db.js';
import { createHttpClient } from '../../apps/hub/core/http-client.js';
import { createLogger } from '../../apps/hub/core/log.js';
import { DEFAULT_AUTH_TYPE_DIRS, dirsFromEnv, loadRegistry } from '../../apps/hub/core/registry.js';
import { createVault } from '../../apps/hub/core/vault.js';
import { contractFixtures } from '../contract/fixtures.js';
import { startMockProvider } from '../mock-provider/app.js';

const TENANT = 'itest';
const config = loadConfig();
const provider = await startMockProvider();
const { control } = provider;
const fixtures = contractFixtures(provider);

// Fixture connectors: generic OAuth, WordPress-style app password, and `acme` — a connector that
// exists only as a definition file (CN-04).
const dir = mkdtempSync(join(tmpdir(), 'hub-itest-connectors-'));
const oauth = fixtures.oauth2.definition;
writeFileSync(join(dir, 'oauth.json'), JSON.stringify({ ...oauth, id: 'itest-oauth' }));
writeFileSync(join(dir, 'wordpress.json'), JSON.stringify({ ...fixtures.app_password.definition, id: 'itest-wordpress' }));
writeFileSync(join(dir, 'acme.json'), JSON.stringify({
  ...oauth, id: 'itest-acme', name: 'Acme', env: { clientId: 'ACME_CLIENT_ID', clientSecret: 'ACME_CLIENT_SECRET' },
  settings: { ...oauth.settings, clientAuth: 'body', scopes: ['crm'] },
}));
const registry = await loadRegistry({
  authTypeDirs: dirsFromEnv(undefined, DEFAULT_AUTH_TYPE_DIRS),
  connectorDirs: [dir],
  env: { MOCK_CLIENT_ID: control.client.id, MOCK_CLIENT_SECRET: control.client.secret, ACME_CLIENT_ID: control.client.id, ACME_CLIENT_SECRET: control.client.secret },
});

const vault = createVault({ keys: config.masterKeys, current: config.currentKeyVersion });
const logLines = [];
const log = createLogger({ write: (line) => logLines.push(line) });
const pools = [connect(config.databaseUrl, { max: 4 }), connect(config.databaseUrl, { max: 4 })];
const sql = pools[0];
// Two service instances on separate pools stand in for two Hub instances (NF-07).
const [service, otherInstance] = pools.map((pool) =>
  createConnections({ sql: pool, vault, registry, tenantId: TENANT, http: createHttpClient({ allowPrivate: true }), baseUrl: 'http://hub.test', audit: createAudit({ sql: pool, tenantId: TENANT, redact: log.redact }), log }));
const sub = `itest-${Date.now()}`;

after(async () => {
  await sql`delete from connections where tenant_id = ${TENANT} and sub = ${sub}`;
  await sql`delete from oauth_states where tenant_id = ${TENANT} and sub = ${sub}`;
  await Promise.all(pools.map((pool) => pool.end()));
  await provider.close();
  rmSync(dir, { recursive: true, force: true });
});

// Browser leg of the redirect flow: follow the provider's auto-approve back to the Hub callback.
const oauthConnect = async ({ connectorId, label, connectionId, as = sub }) => {
  const { redirectUrl } = await service.startOAuth({ sub: as, connectorId, label, connectionId });
  const callback = new URL((await fetch(redirectUrl, { redirect: 'manual' })).headers.get('location'));
  assert.equal(callback.origin + callback.pathname, 'http://hub.test/connect/callback');
  return service.completeOAuth({ sub: as, query: callback.searchParams });
};
const tokenCalls = () => control.calls()['POST /oauth/token'] ?? 0;
const rejectsWith = (promise, code) => assert.rejects(promise, (err) => err instanceof ApiError && err.code === code);
const auditRows = (connectionId) => sql`select event_type, result, error_code, detail from audit_log where tenant_id = ${TENANT} and connection_id = ${connectionId} order by id`;

test('OAuth connect: active connection, sealed secret, audited (VA-01, VA-02, VA-03, AU-02)', async () => {
  control.reset();
  const { connection } = await oauthConnect({ connectorId: 'itest-oauth', label: 'My portal' });
  assert.equal(connection.status, 'active');
  assert.equal(connection.providerAccountId, 'mock-user-1');
  const [secret] = await sql`select key_version, sealed from connection_secrets where tenant_id = ${TENANT} and connection_id = ${connection.id}`;
  assert.equal(secret.key_version, vault.current);
  assert.equal(/mock_[ar]t_/.test(secret.sealed.toString('latin1')), false, 'no plaintext token in the database (S12)');
  assert.deepEqual((await auditRows(connection.id)).map((r) => [r.event_type, r.result]), [['connection.create', 'success']]);
});

test('multiple labelled connections per connector (VA-01)', async () => {
  control.reset();
  await oauthConnect({ connectorId: 'itest-oauth', label: 'Second portal' });
  const labels = (await service.list(sub)).filter((c) => c.connectorId === 'itest-oauth').map((c) => c.label);
  assert.ok(labels.includes('My portal') && labels.includes('Second portal'), labels.join(', '));
});

test('app password connect; a failing credential test stores nothing and is audited (VA-03)', async () => {
  control.reset();
  control.addAppPassword('admin', 'abcd efgh ijkl mnop');
  const site = { siteUrl: provider.url, username: 'admin', appPassword: 'abcd efgh ijkl mnop' };
  const created = await service.createFromInput({ sub, connectorId: 'itest-wordpress', label: 'client-site.com', input: site });
  assert.equal(created.status, 'active');
  assert.equal(created.baseUrl, `${provider.url}/wp-json`);
  const before = (await service.list(sub)).length;
  await rejectsWith(service.createFromInput({ sub, connectorId: 'itest-wordpress', label: 'bad', input: { ...site, appPassword: 'wrong' } }), 'connection_test_failed');
  assert.equal((await service.list(sub)).length, before);
  const [failure] = await sql`select result, error_code, detail from audit_log where tenant_id = ${TENANT} and sub = ${sub} and error_code = 'connection_test_failed'`;
  assert.deepEqual([failure.result, failure.detail.status], ['failure', 401]);
});

test('a connector added as a definition file only works end to end (CN-04)', async () => {
  control.reset();
  const { connection } = await oauthConnect({ connectorId: 'itest-acme', label: 'Acme' });
  const { issued } = await service.issue({ sub, connectionId: connection.id });
  assert.match(issued.secret.accessToken, /^mock_at_/);
});

test('issue: no refresh far from expiry; near expiry exactly one refresh across instances (VA-05, NF-07)', async () => {
  control.reset();
  const { connection } = await oauthConnect({ connectorId: 'itest-oauth', label: 'Fresh' });
  let calls = tokenCalls();
  const plain = await service.issue({ sub, connectionId: connection.id });
  assert.equal(tokenCalls(), calls, 'no refresh for a token valid for an hour');
  assert.equal(JSON.stringify(plain.issued).includes('mock_rt_'), false, 'never a refresh token (TV-05)');

  control.setExpiresIn(60);
  const { connection: expiring } = await oauthConnect({ connectorId: 'itest-oauth', label: 'Expiring' });
  control.setExpiresIn(3600);
  control.setRefreshDelay(200);
  calls = tokenCalls();
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? otherInstance : service).issue({ sub, connectionId: expiring.id })));
  assert.equal(tokenCalls() - calls, 1, 'one refresh for 20 concurrent requests on two instances');
  assert.equal(new Set(results.map((r) => r.issued.secret.accessToken)).size, 1);
  assert.notEqual(results[0].connection.last_refreshed_at, null);
});

test('rejected refresh -> needs_reauth + connection_reauth_required; reconnect restores it (VA-04, S7)', async () => {
  control.reset();
  control.setExpiresIn(60);
  const { connection } = await oauthConnect({ connectorId: 'itest-oauth', label: 'Will fail' });
  control.setFailRefresh(true);
  await assert.rejects(service.issue({ sub, connectionId: connection.id }), (err) =>
    err.code === 'connection_reauth_required' && err.status === 409 && err.details.reconnectUrl === `http://hub.test/connect/start?connectionId=${connection.id}`);
  const [row] = await sql`select status, last_error_code from connections where tenant_id = ${TENANT} and id = ${connection.id}`;
  assert.deepEqual([row.status, row.last_error_code], ['needs_reauth', 'refresh_failed']);
  const calls = tokenCalls();
  await rejectsWith(service.issue({ sub, connectionId: connection.id }), 'connection_reauth_required');
  assert.equal(tokenCalls(), calls, 'no further refresh attempts once needs_reauth');
  assert.ok((await auditRows(connection.id)).some((r) => r.event_type === 'connection.refresh_failure' && r.error_code === 'refresh_failed'));

  control.setFailRefresh(false);
  control.setExpiresIn(3600);
  const { connection: back } = await oauthConnect({ connectionId: connection.id });
  assert.deepEqual([back.id, back.status, back.label], [connection.id, 'active', 'Will fail']);
  assert.ok((await auditRows(connection.id)).some((r) => r.event_type === 'connection.reconnect'));
});

test('disconnect revokes at the provider and deletes everything (VA-06)', async () => {
  control.reset();
  const { connection } = await oauthConnect({ connectorId: 'itest-oauth', label: 'To delete' });
  await service.remove({ sub, connectionId: connection.id });
  assert.equal(control.calls()['POST /oauth/revoke'], 1);
  assert.equal((await sql`select 1 from connection_secrets where tenant_id = ${TENANT} and connection_id = ${connection.id}`).length, 0);
  await rejectsWith(service.issue({ sub, connectionId: connection.id }), 'connection_not_found');
  const deleted = (await auditRows(connection.id)).find((r) => r.event_type === 'connection.delete');
  assert.equal(deleted.detail.providerRevoked, true);
});

test("another user's connection is not found; OAuth state is single-use and user-bound", async () => {
  control.reset();
  const { connection } = await oauthConnect({ connectorId: 'itest-oauth', label: 'Mine' });
  await rejectsWith(service.issue({ sub: `${sub}-other`, connectionId: connection.id }), 'connection_not_found');
  await rejectsWith(service.remove({ sub: `${sub}-other`, connectionId: connection.id }), 'connection_not_found');

  const { redirectUrl } = await service.startOAuth({ sub, connectorId: 'itest-oauth', label: 'Replay' });
  const query = new URL((await fetch(redirectUrl, { redirect: 'manual' })).headers.get('location')).searchParams;
  await rejectsWith(service.completeOAuth({ sub: `${sub}-other`, query }), 'invalid_state');
  await service.completeOAuth({ sub, query });
  await rejectsWith(service.completeOAuth({ sub, query }), 'invalid_state');
});

test('no tokens or secrets in logs or audit entries (VA-07)', async () => {
  const audit = await sql`select detail::text as detail, error_code from audit_log where tenant_id = ${TENANT} and sub = ${sub}`;
  const text = [...logLines, ...audit.map((r) => `${r.detail} ${r.error_code}`)].join('\n');
  assert.equal(/mock_[ar]t_|mock-secret|abcd ?efgh/.test(text), false);
});
