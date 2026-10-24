// Reconciliation safety rails (VA-08 backstop) and webhook signature checks (VA-08).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { findOrphans } from '../../apps/hub/core/users.js';
import { verifySignature } from '../../apps/hub/routes/webhooks.js';

// Minimal tagged-template stand-in returning the given Hub subs.
const fakeSql = (subs) => async () => subs.map((sub) => ({ sub }));

test('reconcile: refuses an empty Logto user list', async () => {
  await assert.rejects(findOrphans({ sql: fakeSql(['a']), tenantId: 't', logtoUserIds: new Set() }), /no users/);
});

test('reconcile: refuses when too many Hub users are missing unless forced', async () => {
  const subs = Array.from({ length: 10 }, (_, i) => `u${i}`);
  const logto = new Set(['u0', 'u1', 'u2', 'u3', 'u4', 'x']);
  await assert.rejects(findOrphans({ sql: fakeSql(subs), tenantId: 't', logtoUserIds: logto }), /5 of 10 Hub users are missing/);
  assert.equal((await findOrphans({ sql: fakeSql(subs), tenantId: 't', logtoUserIds: logto, force: true })).orphans.length, 5);
});

test('reconcile: a small number of orphans proceeds', async () => {
  const { subs, orphans } = await findOrphans({ sql: fakeSql(['a', 'b', 'c']), tenantId: 't', logtoUserIds: new Set(['a', 'b']) });
  assert.deepEqual([subs, orphans], [3, ['c']]);
});

test('webhook signature: hex HMAC-SHA256 of the raw body; anything else fails', () => {
  const body = '{"event":"User.Deleted","user":{"id":"u1"}}';
  const good = createHmac('sha256', 'signing-key').update(body).digest('hex');
  assert.equal(verifySignature('signing-key', body, good), true);
  for (const bad of [undefined, '', good.slice(1), good.toUpperCase(), createHmac('sha256', 'other').update(body).digest('hex')]) {
    assert.equal(verifySignature('signing-key', body, bad), false, String(bad));
  }
  assert.equal(verifySignature('signing-key', `${body} `, good), false, 'any byte change fails');
});
