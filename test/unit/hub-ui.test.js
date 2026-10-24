// Hub UI server pieces: static file resolution (no traversal), timezone validation (ID-06), admin gate (UI-05).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isTimezone } from '../../apps/hub/core/account.js';
import { requireAdmin } from '../../apps/hub/core/security.js';
import { resolveStatic } from '../../apps/hub/core/static.js';

const root = mkdtempSync(join(tmpdir(), 'hub-ui-dist-'));
mkdirSync(join(root, 'assets'));
writeFileSync(join(root, 'index.html'), '<!doctype html>');
writeFileSync(join(root, 'assets', 'app.js'), '');
writeFileSync(join(root, '.env'), 'SECRET=1');
writeFileSync(join(tmpdir(), 'outside.txt'), 'x');
after(() => rmSync(root, { recursive: true, force: true }));

test('static: serves files under the build directory only', () => {
  assert.equal(resolveStatic(root, '/assets/app.js'), join(root, 'assets', 'app.js'));
  assert.equal(resolveStatic(root, '/index.html'), join(root, 'index.html'));
  for (const bad of ['/../outside.txt', '/assets/../../outside.txt', '/%2e%2e/outside.txt', '/.env', '/assets/%00x', '/%E0%A4%A', '/assets', '/connections']) {
    assert.equal(resolveStatic(root, bad), null, bad);
  }
});

test('timezones: IANA names only', () => {
  for (const tz of ['Europe/London', 'America/New_York', 'UTC']) assert.equal(isTimezone(tz), true, tz);
  for (const tz of ['Mars/Olympus', 'europe/london', '', '../etc']) assert.equal(isTimezone(tz), false, tz);
});

test('admin gate: owner or admin role required', () => {
  const ctx = (roles) => ({ session: { user: roles && { sub: 'u', roles } } });
  for (const roles of [['owner'], ['user', 'admin']]) assert.doesNotThrow(() => requireAdmin(ctx(roles), ['owner', 'admin']));
  assert.throws(() => requireAdmin(ctx(['user']), ['owner', 'admin']), (err) => err.code === 'forbidden' && err.status === 403);
  assert.throws(() => requireAdmin(ctx(null), ['owner', 'admin']), (err) => err.code === 'login_required');
});
