// S10: the Hub API rejects a token for another audience, an expired/altered token, and a token
// without connections:token. (Logto cannot mint an already-expired token on demand: the `exp` case
// is an altered token here, which fails the signature check; true expiry is covered by unit tests.)
import { test, expect } from './fixtures.js';
import { appToken, expectAudit, hubApi } from './lib/stack.js';

const expectError = (res, status, code) => expect([res.status, res.body.error?.code]).toEqual([status, code]);

test('S10: other audience, altered exp, missing scope -> rejected', async ({ user }) => {
  expectError(await hubApi('GET', '/v1/connections', await appToken(user, { resource: 'https://api.authworks.local', scope: 'read:sample' })), 401, 'invalid_token');

  const valid = await appToken(user);
  const [header, payload, signature] = valid.split('.');
  const expired = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), exp: Math.floor(Date.now() / 1000) - 60 })).toString('base64url');
  expectError(await hubApi('GET', '/v1/connections', `${header}.${expired}.${signature}`), 401, 'invalid_token');
  expectError(await hubApi('GET', '/v1/connections'), 401, 'invalid_token');
  expectAudit({ event: 'api.reject', errorCode: 'invalid_token' });

  expectError(await hubApi('POST', '/v1/credentials', await appToken(user, { scope: 'connections:read' }), { connectorId: 'hubspot' }), 403, 'insufficient_scope');
  expectAudit({ event: 'api.reject', sub: user.id, errorCode: 'insufficient_scope' });
});
