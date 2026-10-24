// Phase 7.3: the internal-app pattern (IA-01..IA-03). An internal API declared as a Logto resource
// (`https://api.authworks.local`) verifies Logto JWTs with apps/lib/jwt.js and authorizes from the
// roles/scope claims. It needs no Hub: every outbound request it makes is recorded, and only
// Logto's JWKS may appear.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createVerifier } from '../../apps/lib/jwt.js';
import { createClient } from '../../scripts/lib/experience.js';
import { api } from '../../scripts/lib/logto.js';

const sso = JSON.parse(readFileSync(new URL('../../config/sso.config.json', import.meta.url)));
const rpApp = sso.applications.find((a) => a.key === 'sample-rp');
const RESOURCE = rpApp.resource;
const issuer = `${process.env.LOGTO_ENDPOINT.replace(/\/$/, '')}/oidc`;
const cleanups = [];
after(async () => { for (const fn of cleanups.reverse()) await fn().catch((err) => console.error('cleanup:', err.message)); });

// Outbound requests made while the internal API handles calls.
const outbound = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) => {
  outbound.push(String(url));
  return realFetch(url, init);
};
cleanups.push(async () => { globalThis.fetch = realFetch; });

// The internal API: verify the token, then authorize from claims.
const verify = createVerifier({ issuer, audience: RESOURCE });
const server = createServer(async (req, res) => {
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  let claims;
  try {
    claims = await verify(/^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '');
  } catch {
    return send(401, { error: 'invalid_token' });
  }
  const scopes = (claims.scope ?? '').split(' ');
  if (!scopes.includes('read:sample')) return send(403, { error: 'insufficient_scope' });
  send(200, { sub: claims.sub, roles: claims.roles ?? [], scopes });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
cleanups.push(async () => server.close());
const API = `http://127.0.0.1:${server.address().port}`;

const password = `It!${randomBytes(9).toString('base64url')}9a`;
const customData = Object.fromEntries(sso.customProfileFields.filter((f) => f.required).map((f) => [f.name, 'Integration']));
const user = await api('POST', '/api/users', { primaryEmail: `it-ia-${Date.now()}@example.com`, password, customData });
cleanups.push(() => api('DELETE', `/api/users/${user.id}`));
const client = createClient({ clientId: process.env.SAMPLE_RP_CLIENT_ID, clientSecret: process.env.SAMPLE_RP_CLIENT_SECRET, redirectUri: rpApp.redirectUris[0] });
const tokenFor = async (resource, scope) => {
  const { tokens, error } = await client.signIn(user.primaryEmail, password, { scope: `openid offline_access ${scope}`, resource });
  assert.ok(tokens, `sign-in failed: ${error}`);
  return (await client.token({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, resource })).data.access_token;
};
const call = async (token) => {
  const res = await realFetch(API, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json() };
};

test('internal API accepts its own resource token and reads roles/permissions; no Hub call (IA-01..IA-03)', async () => {
  const token = await tokenFor(RESOURCE, 'read:sample');
  outbound.length = 0;
  const res = await call(token);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.sub, user.id);
  assert.ok(res.body.roles.includes('user'), res.body.roles.join(','));
  assert.ok(res.body.scopes.includes('read:sample'));
  assert.deepEqual([...new Set(outbound)], [`${issuer}/jwks`]);
});

test('internal API rejects a Hub-audience token and a token without its scope', async () => {
  assert.equal((await call(await tokenFor(sso.hub.resource, 'connections:read'))).status, 401);
  assert.equal((await call(await tokenFor(RESOURCE, ''))).status, 403);
});
