// Extra (UI-05, AU-04): a Hub admin sees connector status, client settings, and a filterable audit
// log; a plain `user` gets no Admin nav and a 403 from the admin API.
import { test, expect } from './fixtures.js';
import { URLS, assignRole, hubApi } from './lib/stack.js';
import { hubOpen } from './pages/hub.js';

test('admin role: connectors, clients, audit filters', async ({ page, user }) => {
  await assignRole(user.id, 'admin');
  await hubApi('GET', '/v1/connections'); // guarantees at least one api.reject row
  await hubOpen(page, user);
  await page.getByRole('link', { name: 'Admin' }).click();
  await expect(page.getByRole('heading', { name: 'Hub admin' })).toBeVisible();
  await expect(page.getByText('(hubspot, oauth2)')).toBeVisible();

  await page.getByRole('tab', { name: 'Client apps' }).click();
  await expect(page.getByText('Sample RP (sample-rp)')).toBeVisible();
  await expect(page.getByText('Second Client (second-client)')).toBeVisible();

  await page.getByRole('tab', { name: 'Audit log' }).click();
  await page.locator('#f-event').selectOption('api.reject');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  const events = page.locator('tbody tr td:nth-child(2)');
  await expect(events.first()).toHaveText('api.reject');
  expect(new Set(await events.allInnerTexts())).toEqual(new Set(['api.reject']));

  await page.locator('#f-sub').fill('no-such-user');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page.getByText('No entries match.')).toBeVisible();
});

test('user role: no Admin nav, admin API 403', async ({ page, user }) => {
  await hubOpen(page, user);
  await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0);
  expect((await page.request.get(`${URLS.hub}/ui-api/admin/connectors`)).status()).toBe(403);
  await page.goto(`${URLS.hub}/admin`);
  await expect(page.getByText('You do not have access to this page.')).toBeVisible();
});
