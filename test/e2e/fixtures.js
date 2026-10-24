// Shared Playwright fixtures: every Hub JSON response the browser sees goes to the ledger (S14), and
// `user` is a fresh Management-API user (email + password, displayName set, no MFA).
import { test as base, expect } from '@playwright/test';
import { URLS, newUser, record } from './lib/stack.js';

export const test = base.extend({
  page: async ({ page }, use) => {
    page.on('response', async (res) => {
      if (!res.url().startsWith(URLS.hub) || !(res.headers()['content-type'] ?? '').includes('json')) return;
      const body = await res.json().catch(() => null);
      if (body) record('response', { path: new URL(res.url()).pathname, body });
    });
    await use(page);
  },
  user: async ({}, use, testInfo) => {
    await use(await newUser(testInfo.file.split('/').pop().replace('.spec.js', '')));
  },
});
export { expect };
