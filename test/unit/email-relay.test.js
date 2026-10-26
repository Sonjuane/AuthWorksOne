// Cloudflare email relay (build plan 1.10): template rendering, auth, and the send request,
// against a mocked Cloudflare Email Sending API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { renderEmail, startRelay } from '../../apps/email-relay/relay.js';

const { templates } = JSON.parse(readFileSync(new URL('../../config/sso.config.json', import.meta.url))).email;
const AUTH = 'Bearer relay-secret';

async function withRelay(cloudflare, run) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const { status = 200, body } = cloudflare(calls.at(-1));
    return new Response(JSON.stringify(body), { status });
  };
  const server = startRelay({ port: 0, templates, authorization: AUTH, from: 'auth@example.com', accountId: 'acc1', apiToken: 'cf-token', fetch, onListen: () => {} });
  await once(server, 'listening');
  const post = (body, authorization = AUTH) => globalThis.fetch(`http://localhost:${server.address().port}/email`, {
    method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  try { await run({ post, calls }); } finally { server.close(); }
}

const delivered = ({ body }) => ({ body: { success: true, errors: [], result: { delivered: [body.to], permanent_bounces: [], queued: [] } } });

test('renderEmail fills {{code}} from the config template for the usage type (EM-03)', () => {
  assert.deepEqual(renderEmail(templates, { type: 'ForgotPassword', payload: { code: '123456' } }), {
    subject: 'AuthWorks password reset code: 123456',
    text: 'Your password reset code is 123456.',
  });
});

test('renderEmail falls back to Generic for usage types without a template', () => {
  assert.equal(renderEmail(templates, { type: 'MfaVerification', payload: { code: '42' } }).text, 'Your verification code is 42.');
});

test('relay sends the rendered template through the Cloudflare API', async () => {
  await withRelay(delivered, async ({ post, calls }) => {
    const res = await post({ to: 'user@example.com', type: 'Register', payload: { code: '654321' }, ip: '10.0.0.1' });
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.cloudflare.com/client/v4/accounts/acc1/email/sending/send');
    assert.equal(calls[0].init.headers.authorization, 'Bearer cf-token');
    assert.deepEqual(calls[0].body, {
      to: 'user@example.com',
      from: 'auth@example.com',
      subject: 'AuthWorks verification code: 654321',
      text: 'Your verification code is 654321.',
    });
  });
});

test('relay rejects a wrong Authorization header and a malformed body without calling Cloudflare', async () => {
  await withRelay(delivered, async ({ post, calls }) => {
    assert.equal((await post({ to: 'u@example.com', type: 'SignIn', payload: { code: '1' } }, 'Bearer wrong')).status, 401);
    assert.equal((await post({ to: 'u@example.com', type: 'SignIn', payload: {} })).status, 400);
    assert.equal(calls.length, 0);
  });
});

test('relay returns 502 on a Cloudflare error or a permanent bounce', async () => {
  const errors = [{ code: 10102, message: 'email.sending.error.authentication.forbidden' }];
  await withRelay(() => ({ status: 403, body: { success: false, errors, result: null } }), async ({ post }) => {
    const res = await post({ to: 'u@example.com', type: 'SignIn', payload: { code: '1' } });
    assert.equal(res.status, 502);
    assert.deepEqual((await res.json()).errors, errors);
  });
  await withRelay(({ body }) => ({ body: { success: true, errors: [], result: { delivered: [], permanent_bounces: [body.to], queued: [] } } }), async ({ post }) => {
    assert.equal((await post({ to: 'gone@example.com', type: 'SignIn', payload: { code: '1' } })).status, 502);
  });
});
