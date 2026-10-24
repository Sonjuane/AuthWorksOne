// E2E global setup (spec §7.2): check the authworks-test stack runs, bring the Hub database and the
// Logto tenant up to date (SSO_PROFILE=test from .env.test), recreate the Hub and client apps on the
// generated credentials, and reset the mock provider and run ledger.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { URLS, compose, control, repo, runtime, waitFor } from './lib/stack.js';

const run = (script) => execFileSync(process.execPath, ['--env-file=.env.test', script], { cwd: repo, stdio: ['ignore', 'ignore', 'inherit'] });

export default async function globalSetup() {
  const running = compose('ps', '--services', '--status', 'running').split('\n');
  const missing = ['postgres', 'logto', 'mailbox', 'mock-provider'].filter((service) => !running.includes(service));
  if (missing.length) throw new Error(`authworks-test stack is not running (${missing.join(', ')}): npm run down && npm run e2e:up (runbook §9)`);
  await waitFor(`${URLS.logto}/oidc/.well-known/openid-configuration`);

  run('scripts/hub-db-init.js');
  run('scripts/hub-migrate.js');
  run('scripts/provision.js');
  process.loadEnvFile(new URL('.env.test.apps', repo));

  // S17 drops connector files here; empty it (keep the directory: it is a bind-mount source).
  const connectors = new URL('connectors/', runtime);
  mkdirSync(connectors, { recursive: true });
  for (const file of readdirSync(connectors)) rmSync(new URL(file, connectors));
  rmSync(new URL('ledger.jsonl', runtime), { force: true });
  writeFileSync(new URL('run.json', runtime), JSON.stringify({ startedAt: new Date().toISOString() }));

  // Rebuild (cached when unchanged) so the Hub image runs the current code.
  compose('up', '-d', '--build', '--force-recreate', 'hub', 'sample-rp', 'second-client');
  await Promise.all([waitFor(`${URLS.hub}/health`), waitFor(URLS.rp), waitFor(URLS.second)]);
  await control('reset');
}
