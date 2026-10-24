// Shared contract suite for auth type handlers (EX-06). Every handler module must pass it, run
// against the mock provider with a fixture connector definition:
//   fixture = { definition, client?, input?, badInput?, refreshable?, revokeEffective? }
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { handlerContext, HandlerError, interfaceErrors } from '../../apps/hub/core/extension.js';

const REDIRECT_URI = 'http://hub.test/connect/callback';

// Every nested key of an object (to prove no refresh token leaks through getCredentials).
const allKeys = (value) =>
  value && typeof value === 'object' ? Object.entries(value).flatMap(([k, v]) => [k, ...allKeys(v)]) : [];

export function authTypeContract(handler, fixture, { control }) {
  const name = `auth type ${handler.type}`;
  const entry = { definition: fixture?.definition, client: fixture?.client };
  const ctx = () => handlerContext(entry, { input: fixture.input, redirectUri: REDIRECT_URI });
  const redirectFlow = typeof handler.authorize === 'function';

  // Runs the connect step the way core will: redirect round trip or collected input.
  const connect = async () => {
    if (!redirectFlow) return handler.collectCredentials(ctx(), fixture.input);
    const state = randomBytes(8).toString('hex');
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    const { redirectUrl } = await handler.authorize(ctx(), { state, codeChallenge });
    const res = await fetch(redirectUrl, { redirect: 'manual' });
    const query = new URL(res.headers.get('location')).searchParams;
    assert.equal(query.get('state'), state, 'state round-trips through the provider');
    return handler.handleCallback(ctx(), { query, codeVerifier });
  };

  test(`${name}: has a contract fixture`, () => assert.ok(fixture?.definition, `add a fixture for "${handler.type}" in test/contract/fixtures.js`));
  if (!fixture?.definition) return;

  test(`${name}: implements the interface`, () => {
    assert.deepEqual(interfaceErrors(handler), []);
    assert.ok(handler.secretFields.length > 0);
  });

  test(`${name}: connects and passes its credential test (VA-03)`, async () => {
    control.reset();
    fixture.setup?.(control);
    const credential = await connect();
    assert.equal(credential.kind, handler.type);
    const result = await handler.test(ctx(), credential);
    assert.equal(result.ok, true, `test request -> ${result.status}`);
    assert.ok(result.account?.id, 'test request yields a provider account id');
  });

  test(`${name}: issues exactly its secret fields and never a refresh token (TV-05)`, async () => {
    control.reset();
    fixture.setup?.(control);
    const credential = await connect();
    const issued = handler.getCredentials(ctx(), credential);
    assert.deepEqual(Object.keys(issued.secret).sort(), [...handler.secretFields].sort());
    assert.ok(Object.values(issued.secret).every((v) => typeof v === 'string' && v.length > 0));
    assert.ok(issued.expiresAt === null || !Number.isNaN(Date.parse(issued.expiresAt)));
    assert.deepEqual(allKeys(issued).filter((k) => /refresh/i.test(k)), []);
    if (credential.refreshToken) assert.equal(JSON.stringify(issued).includes(credential.refreshToken), false);
  });

  test(`${name}: bad credentials fail the credential test`, async () => {
    control.reset();
    fixture.setup?.(control);
    const credential = redirectFlow
      ? { ...(await connect()), accessToken: 'mock_at_not_issued' }
      : await handler.collectCredentials(ctx(), fixture.badInput);
    assert.equal((await handler.test(ctx(), credential)).ok, false);
  });

  if (fixture.refreshable) {
    test(`${name}: refresh issues a new access token; a rejected refresh -> refresh_failed (VA-04)`, async () => {
      control.reset();
      const credential = await connect();
      const refreshed = await handler.refresh(ctx(), credential);
      assert.notEqual(refreshed.accessToken, credential.accessToken);
      assert.equal(refreshed.refreshToken, credential.refreshToken, 'refresh token kept when the provider omits it');
      assert.equal((await handler.test(ctx(), refreshed)).ok, true);
      control.setFailRefresh(true);
      await assert.rejects(handler.refresh(ctx(), refreshed), (err) => err instanceof HandlerError && err.code === 'refresh_failed');
    });
  }

  if (typeof handler.revoke === 'function') {
    test(`${name}: revoke is idempotent${fixture.revokeEffective ? ' and invalidates the credential' : ''} (VA-06)`, async () => {
      control.reset();
      fixture.setup?.(control);
      const credential = await connect();
      await handler.revoke(ctx(), credential);
      await handler.revoke(ctx(), credential);
      if (fixture.revokeEffective) assert.equal((await handler.test(ctx(), credential)).ok, false);
    });
  }
}
