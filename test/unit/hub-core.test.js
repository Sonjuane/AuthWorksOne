// Hub core unit tests: vault (VA-02), redacting logger (NF-09, VA-07), JWT verifier + caller
// authentication (HA-01..HA-05), config/secret checks (NF-05, NF-06).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createVerifier } from '../../apps/lib/jwt.js';
import { ApiError, createAuthenticator } from '../../apps/hub/core/auth.js';
import { ConfigError, loadConfig } from '../../apps/hub/core/config.js';
import { createLogger } from '../../apps/hub/core/log.js';
import { createVault, parseMasterKeys } from '../../apps/hub/core/vault.js';

const key = () => randomBytes(32).toString('base64');

// --- Vault ---
test('vault: seal/open round trip; ciphertext hides the plaintext', () => {
  const vault = createVault({ keys: parseMasterKeys(`v1:${key()}`), current: 'v1' });
  const secret = { accessToken: 'mock_at_plaintext_value' };
  const sealed = vault.seal(secret, 'default|t|1');
  assert.equal(sealed.includes(Buffer.from('mock_at_plaintext_value')), false);
  assert.deepEqual(vault.open(sealed, 'default|t|1'), secret);
  assert.equal(vault.versionOf(sealed), 'v1');
});

test('vault: tampering or a different row (AAD) fails to open', () => {
  const vault = createVault({ keys: parseMasterKeys(`v1:${key()}`), current: 'v1' });
  const sealed = vault.seal({ a: 1 }, 'default|t|1');
  const tampered = Buffer.from(sealed);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => vault.open(tampered, 'default|t|1'));
  assert.throws(() => vault.open(sealed, 'default|t|2'));
});

test('vault: records sealed with an older key version still open after rotation', () => {
  const v1 = key();
  const old = createVault({ keys: parseMasterKeys(`v1:${v1}`), current: 'v1' });
  const sealed = old.seal({ a: 1 }, 'x');
  const rotated = createVault({ keys: parseMasterKeys(`v1:${v1},v2:${key()}`), current: 'v2' });
  assert.deepEqual(rotated.open(sealed, 'x'), { a: 1 });
  assert.equal(rotated.versionOf(rotated.seal({ a: 1 }, 'x')), 'v2');
  const withoutV1 = createVault({ keys: parseMasterKeys(`v2:${key()}`), current: 'v2' });
  assert.throws(() => withoutV1.open(sealed, 'x'), /version "v1" is not loaded/);
});

test('vault: master key parsing rejects wrong lengths and unknown current version', () => {
  assert.throws(() => parseMasterKeys('v1:abc'), /32 bytes/);
  assert.throws(() => parseMasterKeys(''), /no keys/);
  assert.throws(() => createVault({ keys: parseMasterKeys(`v1:${key()}`), current: 'v2' }), /not in HUB_MASTER_KEYS/);
});

// --- Logger ---
test('logger: redacts secret-named fields and registered values; output is JSON', () => {
  const lines = [];
  const log = createLogger({ write: (line) => lines.push(line) });
  log.registerSecret('registered-secret-value');
  log.info('event', { access_token: 'abc', nested: { Authorization: 'Bearer x', password: 'p' }, note: 'contains registered-secret-value here', error: new Error('boom registered-secret-value') });
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.access_token, '[REDACTED]');
  assert.equal(entry.nested.Authorization, '[REDACTED]');
  assert.equal(entry.nested.password, '[REDACTED]');
  assert.equal(entry.note, 'contains [REDACTED] here');
  assert.equal(entry.error.message, 'boom [REDACTED]');
  assert.equal(lines[0].includes('registered-secret-value'), false);
});

// --- JWT verifier + authenticator ---
const issuer = 'http://logto.test/oidc';
const audience = 'https://hub.authworks.local';
const { privateKey, publicKey } = await generateKeyPair('ES384');
const { privateKey: otherKey } = await generateKeyPair('ES384');
const keySet = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES384' }] });
const sign = ({ claims = {}, aud = audience, iss = issuer, exp = '5m', typ = 'at+jwt', signer = privateKey } = {}) =>
  new SignJWT({ client_id: 'client-a', scope: 'connections:read connections:token', ...claims })
    .setProtectedHeader({ alg: 'ES384', kid: 'k1', typ })
    .setIssuer(iss).setAudience(aud).setSubject('user-1').setIssuedAt().setExpirationTime(exp)
    .sign(signer);
const authenticate = createAuthenticator({
  verify: createVerifier({ issuer, audience, keySet }),
  clients: new Map([['client-a', { key: 'client-a', allowedConnectors: [], consentReturnUris: [] }]]),
});
const rejects = (promise, status, code) => assert.rejects(promise, (err) => err instanceof ApiError && err.status === status && err.code === code);

test('auth: valid token -> sub, client_id, scopes, roles (HA-01, HA-02)', async () => {
  const caller = await authenticate({ authorization: `Bearer ${await sign({ claims: { roles: ['user'] } })}` }, 'connections:token');
  assert.equal(caller.sub, 'user-1');
  assert.equal(caller.clientId, 'client-a');
  assert.deepEqual(caller.roles, ['user']);
});

test('auth: wrong audience, wrong issuer, expired, bad signature, ID token, missing header -> invalid_token (S10)', async () => {
  for (const token of [
    await sign({ aud: 'https://api.authworks.local' }),
    await sign({ iss: 'http://evil.test/oidc' }),
    await sign({ exp: Math.floor(Date.now() / 1000) - 60 }),
    await sign({ signer: otherKey }),
    await sign({ typ: 'JWT' }),
  ]) await rejects(authenticate({ authorization: `Bearer ${token}` }, 'connections:read'), 401, 'invalid_token');
  await rejects(authenticate({}, 'connections:read'), 401, 'invalid_token');
});

test('auth: missing scope -> insufficient_scope (HA-03, S10)', async () => {
  const token = await sign({ claims: { scope: 'connections:read' } });
  await rejects(authenticate({ authorization: `Bearer ${token}` }, 'connections:token'), 403, 'insufficient_scope');
});

test('auth: unknown client_id -> client_not_registered (HA-05, S11)', async () => {
  const token = await sign({ claims: { client_id: 'client-x' } });
  await rejects(authenticate({ authorization: `Bearer ${token}` }, 'connections:read'), 403, 'client_not_registered');
});

// --- Config ---
const sso = {
  applications: [
    { key: 'hub-ui', port: 3030, scope: 'openid' },
    { key: 'sample-rp', name: 'Sample RP', hub: { allowedConnectors: ['hubspot'], consentReturnUris: ['http://x/return'] } },
    { key: 'second-client', name: 'Second', hub: { allowedConnectors: [], consentReturnUris: [] } },
  ],
  hub: { resource: audience },
};
const env = {
  LOGTO_ENDPOINT: 'http://localhost:3001', HUB_BASE_URL: 'http://localhost:3030', HUB_DATABASE_URL: 'postgres://x',
  HUB_MASTER_KEYS: `v1:${key()}`, HUB_MASTER_KEY_CURRENT: 'v1', HUB_UI_CLIENT_ID: 'ui', HUB_UI_CLIENT_SECRET: 's',
  HUB_WEBHOOK_SIGNING_KEY: 'w', SAMPLE_RP_CLIENT_ID: 'rp-id',
};

test('config: missing secrets are listed and refuse startup (NF-05)', () => {
  assert.throws(() => loadConfig({ env: { ...env, HUB_MASTER_KEYS: '', HUB_UI_CLIENT_SECRET: '' }, sso }), (err) =>
    err instanceof ConfigError && /HUB_MASTER_KEYS, HUB_UI_CLIENT_SECRET/.test(err.message));
});

test('config: production requires an https base URL (NF-06)', () => {
  assert.throws(() => loadConfig({ env: { ...env, NODE_ENV: 'production' }, sso }), /https/);
  assert.equal(loadConfig({ env: { ...env, NODE_ENV: 'production', HUB_BASE_URL: 'https://hub.example' }, sso }).production, true);
});

test('config: per-client settings resolve app keys to client IDs (HA-05)', () => {
  const config = loadConfig({ env: { ...env, LOGTO_INTERNAL_ENDPOINT: 'http://logto:3001' }, sso });
  assert.deepEqual([...config.clients.keys()], ['rp-id']);
  assert.deepEqual(config.clients.get('rp-id').allowedConnectors, ['hubspot']);
  assert.deepEqual(config.skippedClients, ['second-client']);
  assert.equal(config.issuer, 'http://localhost:3001/oidc');
  assert.equal(config.jwksUri, 'http://logto:3001/oidc/jwks');
});
