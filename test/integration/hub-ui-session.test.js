// Live Hub over HTTP (compose `hub` on :3030, dev profile): Logto sign-in for the Hub UI (HA-04),
// silent re-login from the Logto session (SSO), public browser URLs, session + CSRF guards
// (NF-06), and the SSRF guard on user-supplied URLs. Skipped when the Hub is not running.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../../apps/hub/core/config.js';
import { connect } from '../../apps/hub/core/db.js';
import { aadFor } from '../../apps/hub/core/sealed.js';
import { createVault } from '../../apps/hub/core/vault.js';
import { api, endpoint } from '../../scripts/lib/logto.js';
import { appSignIn, browser } from '../../scripts/lib/experience.js';

const HUB = process.env.HUB_BASE_URL ?? 'http://localhost:3030';
const up = await fetch(`${HUB}/health`).then((r) => r.ok, () => false);
const skip = !up && `Hub not reachable at ${HUB} (npm run up)`;
const sso = JSON.parse(readFileSync(new URL('../../config/sso.config.json', import.meta.url)));
const startedAt = new Date();
const cleanups = [];
after(async () => { for (const fn of cleanups.reverse()) await fn(); });

// Hub session rows this test created: written since it started and either signed in as the test
// user or never signed in (login started, or logged out). Audit rows stay (append-only).
const deleteTestSessions = async (userId) => {
  const config = loadConfig();
  const vault = createVault({ keys: config.masterKeys, current: config.currentKeyVersion });
  const sql = connect(config.databaseUrl, { max: 1 });
  for (const row of await sql`select tenant_id, sid_hash, sealed from sessions where updated_at >= ${startedAt}`) {
    const data = vault.open(row.sealed, aadFor(row.tenant_id, 'sessions', row.sid_hash));
    if (!data.user || data.user.sub === userId) await sql`delete from sessions where tenant_id = ${row.tenant_id} and sid_hash = ${row.sid_hash}`;
  }
  await sql.end();
};

let session;
const signIn = async () => {
  if (session) return session;
  const password = `It!${randomBytes(9).toString('base64url')}9a`;
  const customData = Object.fromEntries(sso.customProfileFields.filter((f) => f.required).map((f) => [f.name, 'Integration']));
  const user = await api('POST', '/api/users', { primaryEmail: `it-ui-${Date.now()}@example.com`, password, customData });
  cleanups.push(() => api('DELETE', `/api/users/${user.id}`), () => deleteTestSessions(user.id));
  session = { user, password, ...(await appSignIn({ appUrl: HUB, email: user.primaryEmail, password })) };
  return session;
};

test('Hub login redirects the browser to the public Logto origin (HA-04)', { skip }, async () => {
  const res = await browser(HUB)('GET', '/login');
  assert.equal(res.status, 302);
  assert.equal(new URL(res.location).origin, new URL(endpoint()).origin);
});

test('signed-in session exposes the Logto user and a CSRF token', { skip }, async () => {
  const { app, user } = await signIn();
  const { data } = await app('GET', '/ui-api/session');
  assert.equal(data.data.user.sub, user.id);
  assert.equal(data.data.user.email, user.primaryEmail);
  assert.ok(data.data.csrf.length >= 32);
});

test('a second Hub session signs in silently from the Logto session (SSO)', { skip }, async () => {
  const { logto, user } = await signIn();
  const again = await appSignIn({ appUrl: HUB, logto, email: user.primaryEmail, password: 'not-used-wrong-password' });
  assert.equal((await again.app('GET', '/ui-api/session')).data.data.user.sub, user.id);
});

test('UI API: anonymous -> login_required; writes need the CSRF token (NF-06)', { skip }, async () => {
  const anonymous = await browser(HUB)('GET', '/ui-api/connections');
  assert.deepEqual([anonymous.status, anonymous.data.error.code], [401, 'login_required']);
  const { app } = await signIn();
  const res = await app('POST', '/ui-api/connections', { connectorId: 'wordpress', label: 'x', input: {} });
  assert.deepEqual([res.status, res.data.error.code], [403, 'csrf_failed']);
});

test('connectors list and the SSRF guard on a private WordPress URL (R3)', { skip }, async () => {
  const { app } = await signIn();
  const { data: connectors } = await app('GET', '/ui-api/connectors');
  const wordpress = connectors.data.find((c) => c.id === 'wordpress');
  assert.equal(wordpress.flow, 'form');
  const csrf = (await app('GET', '/ui-api/session')).data.data.csrf;
  const res = await app('POST', '/ui-api/connections', {
    connectorId: 'wordpress', label: 'internal', input: { siteUrl: 'http://127.0.0.1:3097', username: 'admin', appPassword: 'x' },
  }, { 'x-csrf-token': csrf });
  assert.deepEqual([res.status, res.data.error.code], [400, 'invalid_input']);
  const redirect = await app('GET', '/connect/start?connector=wordpress&label=x');
  assert.match(redirect.location, /connect_error=invalid_request/);
});

test('logout returns the browser to the public Logto end-session URL', { skip }, async () => {
  const { app } = await signIn();
  const res = await app('GET', '/logout');
  assert.equal(new URL(res.location).origin, new URL(endpoint()).origin);
  assert.equal((await app('GET', '/ui-api/session')).data.data.user, null);
});
