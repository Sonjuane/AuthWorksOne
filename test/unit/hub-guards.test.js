// Hub request/outbound guards: SSRF (risk R3), refresh window (VA-05), return paths (TV-02 style
// no-open-redirect), CSRF (NF-06), transient secret redaction (VA-07).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsRefresh } from '../../apps/hub/core/connections.js';
import { HandlerError } from '../../apps/hub/core/extension.js';
import { assertAllowedUrl } from '../../apps/hub/core/http-client.js';
import { createLogger } from '../../apps/hub/core/log.js';
import { requireCsrf, safeReturnPath } from '../../apps/hub/core/security.js';

const rejected = (url, opts) => assert.rejects(assertAllowedUrl(url, opts), (err) => err instanceof HandlerError && err.code === 'invalid_input', url);

test('SSRF guard: only https to public addresses by default', async () => {
  for (const url of [
    'http://93.184.216.34/', 'https://127.0.0.1/', 'https://localhost/', 'https://10.1.2.3/', 'https://172.16.0.1/', 'https://192.168.1.1/',
    'https://169.254.169.254/latest/meta-data', 'https://100.64.0.1/', 'https://[::1]/', 'https://[fd00::1]/', 'https://[::ffff:127.0.0.1]/',
    'https://user:pass@93.184.216.34/', 'not a url', 'ftp://93.184.216.34/',
  ]) await rejected(url);
  await assertAllowedUrl('https://93.184.216.34/wp-json');
});

test('SSRF guard: HUB_ALLOW_PRIVATE_URLS mode allows http and local hosts', async () => {
  await assertAllowedUrl('http://localhost:3097/wp-json', { allowPrivate: true });
  await rejected('ftp://localhost/', { allowPrivate: true });
});

test('refresh window: within 5 minutes of expiry, never when there is no expiry (VA-05)', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  assert.equal(needsRefresh('2026-01-01T00:04:59Z', now), true);
  assert.equal(needsRefresh('2026-01-01T00:05:01Z', now), false);
  assert.equal(needsRefresh('2025-12-31T23:00:00Z', now), true);
  assert.equal(needsRefresh(null, now), false);
});

test('return paths stay on the Hub origin', () => {
  for (const bad of ['https://evil.test/', '//evil.test/x', '/\\evil.test', 'javascript:alert(1)', undefined]) assert.equal(safeReturnPath(bad), '/', String(bad));
  assert.equal(safeReturnPath('/connections?x=1'), '/connections?x=1');
});

test('CSRF: the header must match the session token', () => {
  const ctx = (header, csrf) => ({ req: { headers: header ? { 'x-csrf-token': header } : {} }, session: { csrf } });
  assert.doesNotThrow(() => requireCsrf(ctx('token-abc', 'token-abc')));
  for (const [header, csrf] of [[undefined, 'token-abc'], ['token-abd', 'token-abc'], ['x', undefined], ['', '']]) {
    assert.throws(() => requireCsrf(ctx(header, csrf)), (err) => err.code === 'csrf_failed');
  }
});

test('logger: transient credentials are redacted; startup secrets are never evicted', () => {
  const lines = [];
  const log = createLogger({ write: (line) => lines.push(line) });
  log.registerSecret('startup-secret-value');
  for (let i = 0; i < 10_050; i++) log.registerTransient(`mock_at_${String(i).padStart(8, '0')}`);
  log.info('x', { note: 'mock_at_00010049 and startup-secret-value' });
  assert.equal(JSON.parse(lines[0]).note, '[REDACTED] and [REDACTED]');
});
