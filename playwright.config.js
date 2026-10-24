// Playwright E2E (spec §7.1/§7.2, build plan Phase 8) against the authworks-test compose stack
// (docs/01-runbook.md §9). Env: .env.test (+ .env.test.apps, written by provision in global setup).
import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

for (const file of ['.env.test', '.env.test.apps']) if (existsSync(file)) process.loadEnvFile(file);

export default defineConfig({
  testDir: 'test/e2e',
  globalSetup: './test/e2e/global-setup.js',
  globalTeardown: './test/e2e/global-teardown.js',
  // One worker: specs share the mock provider's control state, and S17 restarts the Hub.
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'], trace: 'retain-on-failure' },
});
