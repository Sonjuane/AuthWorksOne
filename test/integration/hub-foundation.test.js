// Phase 2 integration tests: Hub database (NF-02, NF-03, NF-08, AU-02), sealed sessions (S12),
// startup refusal (NF-05), and real Logto access tokens through the Hub authenticator
// (HA-01..HA-05, S10, IA-02). Opt-in signing-key rotation (ID-10): TEST_ROTATE_KEYS=1.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createVerifier } from '../../apps/lib/jwt.js';
import { ApiError, createAuthenticator } from '../../apps/hub/core/auth.js';
import { loadConfig } from '../../apps/hub/core/config.js';
import { connect } from '../../apps/hub/core/db.js';
import { createSessionStore } from '../../apps/hub/core/session-store.js';
import { createVault } from '../../apps/hub/core/vault.js';
import { api } from '../../scripts/lib/logto.js';
import { createClient } from '../../scripts/lib/experience.js';

const cwd = new URL('../..', import.meta.url);
const run = (script, { env = process.env, envFile = true } = {}) =>
  promisify(execFile)(process.execPath, [...(envFile ? ['--env-file=.env'] : []), script], { cwd, env }).catch((err) => err);
const sso = JSON.parse(readFileSync(new URL('config/sso.config.json', cwd)));
const config = loadConfig();
const sql = connect(config.databaseUrl, { max: 2 });
const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
  await sql.end();
});

test('hub:db:init and hub:migrate are idempotent (NF-02, NF-08)', async () => {
  for (const script of ['scripts/hub-db-init.js', 'scripts/hub-migrate.js']) {
    await run(script);
    const { stdout } = await run(script);
    assert.deepEqual(stdout.split('\n').filter((line) => /^\s+\+/.test(line)), [], script);
  }
});

test('every Hub table leads its primary key with tenant_id (NF-03)', async () => {
  const rows = await sql`
    select t.table_name, (
      select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
      where i.indrelid = (quote_ident(t.table_name))::regclass and i.indisprimary
    ) as first_pk_column
    from information_schema.tables t
    where t.table_schema = 'public' and t.table_type = 'BASE TABLE' and t.table_name <> 'schema_migrations'`;
  assert.ok(rows.length >= 6, `tables: ${rows.map((r) => r.table_name)}`);
  for (const row of rows) assert.equal(row.first_pk_column, 'tenant_id', row.table_name);
});

test('audit_log rejects UPDATE, DELETE, and TRUNCATE (AU-02)', async () => {
  const rollback = new Error('rollback');
  await assert.rejects(sql.begin(async (tx) => {
    const [{ id }] = await tx`insert into audit_log (event_type, result) values ('test.append_only', 'success') returning id`;
    for (const statement of [
      (sp) => sp`update audit_log set result = 'failure' where id = ${id}`,
      (sp) => sp`delete from audit_log where id = ${id}`,
      (sp) => sp`truncate audit_log`,
    ]) await assert.rejects(tx.savepoint(statement), /append-only/);
    throw rollback;
  }), (err) => err === rollback);
});

test('sessions are sealed, keyed by hash, and survive a new store instance (NF-02, S12)', async () => {
  const vault = createVault({ keys: config.masterKeys, current: config.currentKeyVersion });
  const sid = randomBytes(16).toString('hex');
  const data = { tokens: { access_token: `mock_at_${randomBytes(8).toString('hex')}` } };
  await createSessionStore({ sql, vault, tenantId: config.tenantId }).set(sid, data);
  cleanups.push(() => sql`delete from sessions where sid_hash = encode(sha256(${sid}::bytea), 'hex')`);
  assert.deepEqual(await createSessionStore({ sql, vault, tenantId: config.tenantId }).get(sid), data);
  const [row] = await sql`select sid_hash, sealed from sessions where sid_hash = encode(sha256(${sid}::bytea), 'hex')`;
  assert.notEqual(row.sid_hash, sid);
  assert.equal(row.sealed.includes(Buffer.from(data.tokens.access_token)), false);
});

test('Hub refuses to start when secrets are missing (NF-05)', async () => {
  const env = { PATH: process.env.PATH, LOGTO_ENDPOINT: process.env.LOGTO_ENDPOINT, HUB_BASE_URL: 'http://localhost:3999' };
  const result = await run('apps/hub/server.js', { env, envFile: false });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /"startup_failed".*HUB_DATABASE_URL, HUB_MASTER_KEYS, HUB_MASTER_KEY_CURRENT/);
});

// --- Real Logto tokens ---
const rp = sso.applications.find((a) => a.key === 'sample-rp');
const client = createClient({ clientId: process.env.SAMPLE_RP_CLIENT_ID, clientSecret: process.env.SAMPLE_RP_CLIENT_SECRET, redirectUri: rp.redirectUris[0] });
const password = `It!${randomBytes(9).toString('base64url')}9a`;
const customData = Object.fromEntries(sso.customProfileFields.filter((f) => f.required).map((f) => [f.name, 'Integration']));
const user = await api('POST', '/api/users', { primaryEmail: `it-hub-${Date.now()}@example.com`, password, customData });
cleanups.push(() => api('DELETE', `/api/users/${user.id}`));

const tokenFor = async (resource, scopes) => {
  const { tokens, error } = await client.signIn(user.primaryEmail, password, { scope: `openid offline_access ${scopes}`, resource });
  assert.ok(tokens, `sign-in failed: ${error}`);
  const res = await client.token({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, resource });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return res.data.access_token;
};
const authenticate = createAuthenticator({
  verify: createVerifier({ issuer: config.issuer, audience: config.resource, jwksUri: config.jwksUri }),
  clients: config.clients,
});
const rejectsWith = (promise, code) => assert.rejects(promise, (err) => err instanceof ApiError && err.code === code);

test('Logto token for the Hub resource identifies user + registered client (HA-01, HA-02, HA-03, HA-05)', async () => {
  const token = await tokenFor(config.resource, 'connections:read connections:token');
  const caller = await authenticate({ authorization: `Bearer ${token}` }, 'connections:token');
  assert.equal(caller.sub, user.id);
  assert.equal(caller.clientId, process.env.SAMPLE_RP_CLIENT_ID);
  assert.equal(caller.client.key, 'sample-rp');
  assert.ok(caller.roles.includes('user'));
});

test('Logto token for another audience or without connections:token is rejected (S10)', async () => {
  const apiToken = await tokenFor('https://api.authworks.local', 'read:sample');
  await rejectsWith(authenticate({ authorization: `Bearer ${apiToken}` }, 'connections:read'), 'invalid_token');
  const readOnly = await tokenFor(config.resource, 'connections:read');
  await rejectsWith(authenticate({ authorization: `Bearer ${readOnly}` }, 'connections:token'), 'insufficient_scope');
});

test('internal-app pattern: verify an API-resource token and read roles/permissions (IA-02, IA-03)', async () => {
  const verify = createVerifier({ issuer: config.issuer, audience: 'https://api.authworks.local', jwksUri: config.jwksUri });
  const claims = await verify(await tokenFor('https://api.authworks.local', 'read:sample'));
  assert.ok(claims.scope.split(' ').includes('read:sample'));
  assert.ok(claims.roles.includes('user'));
});

test('signing-key rotation: tokens from the old and new key both verify (ID-10)', { skip: process.env.TEST_ROTATE_KEYS !== '1' && 'set TEST_ROTATE_KEYS=1 (rotates real keys)' }, async () => {
  const before = (await api('GET', '/api/configs/oidc/private-keys')).map((k) => k.id);
  const oldToken = await tokenFor(config.resource, 'connections:read');
  const rotated = await run('scripts/rotate-keys.js');
  assert.equal(rotated.code ?? 0, 0, rotated.stderr);
  const newKey = (await api('GET', '/api/configs/oidc/private-keys')).find((k) => !before.includes(k.id));
  cleanups.push(() => api('DELETE', `/api/configs/oidc/private-keys/${newKey.id}`));
  const newToken = await tokenFor(config.resource, 'connections:read');
  const verify = createVerifier({ issuer: config.issuer, audience: config.resource, jwksUri: config.jwksUri });
  for (const token of [oldToken, newToken]) assert.equal((await verify(token)).sub, user.id);
});
