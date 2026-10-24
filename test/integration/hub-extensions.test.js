// Phase 3 integration tests: master-key rotation with `npm run hub:reencrypt` (VA-02) and Hub
// startup refusal on an invalid connector definition (CN-05).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../../apps/hub/core/config.js';
import { connect } from '../../apps/hub/core/db.js';
import { aadFor } from '../../apps/hub/core/sealed.js';
import { createVault, parseMasterKeys } from '../../apps/hub/core/vault.js';

const cwd = new URL('../..', import.meta.url);
const run = (script, env) => promisify(execFile)(process.execPath, [script], { cwd, env: { ...process.env, ...env } }).catch((err) => err);
const config = loadConfig();
const sql = connect(config.databaseUrl, { max: 2 });
const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
  await sql.end();
});

test('hub:reencrypt moves sealed rows to the current key version and back (VA-02)', async () => {
  const v1 = process.env.HUB_MASTER_KEYS;
  const both = `${v1},v2:${randomBytes(32).toString('base64')}`;
  const tenant = config.tenantId;
  const sidHash = `test-${randomBytes(8).toString('hex')}`;
  const value = { tokens: { access_token: 'mock_at_reencrypt' } };
  const vaultV1 = createVault({ keys: parseMasterKeys(v1), current: config.currentKeyVersion });
  await sql`insert into sessions (tenant_id, sid_hash, key_version, sealed, expires_at)
    values (${tenant}, ${sidHash}, ${vaultV1.current}, ${vaultV1.seal(value, aadFor(tenant, 'sessions', sidHash))}, now() + interval '1 hour')`;
  cleanups.push(() => sql`delete from sessions where sid_hash = ${sidHash}`);
  const row = async () => (await sql`select key_version, sealed from sessions where sid_hash = ${sidHash}`)[0];

  const forward = await run('scripts/hub-reencrypt.js', { HUB_MASTER_KEYS: both, HUB_MASTER_KEY_CURRENT: 'v2' });
  assert.match(forward.stdout, /\+ sessions: \d+ row/);
  const rotated = await row();
  assert.equal(rotated.key_version, 'v2');
  const vaultV2 = createVault({ keys: parseMasterKeys(both), current: 'v2' });
  assert.deepEqual(vaultV2.open(rotated.sealed, aadFor(tenant, 'sessions', sidHash)), value);
  assert.match((await run('scripts/hub-reencrypt.js', { HUB_MASTER_KEYS: both, HUB_MASTER_KEY_CURRENT: 'v2' })).stdout, /= sessions: 0 rows/);

  // Back to the configured key so the dev database is left as it was.
  const back = await run('scripts/hub-reencrypt.js', { HUB_MASTER_KEYS: both, HUB_MASTER_KEY_CURRENT: config.currentKeyVersion });
  assert.match(back.stdout, /\+ sessions: \d+ row/);
  assert.deepEqual(vaultV1.open((await row()).sealed, aadFor(tenant, 'sessions', sidHash)), value);
});

test('Hub refuses to start when a connector definition is invalid (CN-05)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-bad-connectors-'));
  cleanups.push(async () => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'bad.json'), JSON.stringify({ id: 'bad', name: 'Bad', authType: 'oauth1' }));
  const result = await run('apps/hub/server.js', { HUB_CONNECTOR_DIRS: dir, HUB_PORT: '3998' });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /"startup_failed".*Invalid Hub extensions/);
  assert.match(result.stdout, /bad\.json/);
});
