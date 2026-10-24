// E2E teardown (build plan 8.2): leak and audit scans over the whole run, then test-user cleanup.
// S12 Hub DB plaintext, S13 service logs, S14 Hub API responses, S16 expected audit events.
// Logto and the dev mailbox logs are excluded: third-party, and the mailbox prints codes by design.
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { api } from '../../scripts/lib/logto.js';
import { databaseHits, keyPaths, textHits } from '../lib/scan.js';
import { compose, readLedger, runtime } from './lib/stack.js';

const MOCK_TOKEN = /mock_[ar]t_[0-9a-f]{8,}/;

const envSecrets = () => [
  ...['SAMPLE_RP_CLIENT_SECRET', 'HUB_UI_CLIENT_SECRET', 'SECOND_CLIENT_CLIENT_SECRET', 'HUB_WEBHOOK_SIGNING_KEY', 'LOGTO_M2M_CLIENT_SECRET'].map((name) => process.env[name]),
  ...(process.env.HUB_MASTER_KEYS ?? '').split(',').map((entry) => entry.split(':').slice(1).join(':')),
  'mock-secret',
].filter(Boolean);

const deleteTestUsers = async () => {
  let deleted = 0;
  for (;;) {
    const users = await api('GET', '/api/users?search.primaryEmail=e2e-%25&mode.primaryEmail=like&page_size=100');
    if (!users.length) return deleted;
    for (const user of users) await api('DELETE', `/api/users/${user.id}`);
    deleted += users.length;
  }
};

export default async function globalTeardown() {
  const { startedAt } = JSON.parse(readFileSync(new URL('run.json', runtime), 'utf8'));
  const ledger = readLedger();
  const secrets = [...new Set([...ledger.filter((e) => e.kind === 'secret').map((e) => e.value), ...envSecrets()])];
  const failures = [];
  const report = (scan, hits) => {
    console.log(`${hits.length ? '✖' : '✔'} ${scan}: ${hits.length} hit(s)`);
    if (hits.length) failures.push(`${scan}: ${hits.slice(0, 5).join('; ')}`);
  };

  const sql = postgres(process.env.HUB_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    report(`S12 Hub DB plaintext (${secrets.length} secrets + mock token prefixes)`, await databaseHits(sql, [...secrets, 'mock_at_', 'mock_rt_']));

    const logs = compose('logs', '--no-color', '--since', startedAt, 'hub', 'sample-rp', 'second-client', 'mock-provider');
    report(`S13 service logs (${logs.split('\n').length} lines)`, textHits(logs, secrets, [MOCK_TOKEN, /eyJ[\w-]+\.[\w-]+\./]).map((hit) => `${hit.slice(0, 12)}…`));

    const responses = ledger.filter((e) => e.kind === 'response');
    report(`S14 Hub responses (${responses.length})`, responses.flatMap(({ value }) => [
      ...keyPaths(value.body, /^refresh_?token$/i).map((path) => `${value.path} ${path}`),
      ...(JSON.stringify(value.body).includes('mock_rt_') ? [`${value.path} mock_rt_`] : []),
    ]));

    const rows = await sql`select event_type, sub, client_id, error_code from audit_log where at >= ${startedAt}`;
    const expected = ledger.filter((e) => e.kind === 'audit').map((e) => e.value);
    report(`S16 audit (${expected.length} expected, ${rows.length} rows)`, expected
      .filter((want) => !rows.some((row) => row.event_type === want.event
        && (!want.sub || row.sub === want.sub) && (!want.clientId || row.client_id === want.clientId) && (!want.errorCode || row.error_code === want.errorCode)))
      .map((want) => JSON.stringify(want)));
  } finally {
    await sql.end();
  }

  console.log(`cleanup: deleted ${await deleteTestUsers()} e2e-* user(s)`);
  if (failures.length) throw new Error(`E2E scans failed:\n${failures.join('\n')}`);
}
