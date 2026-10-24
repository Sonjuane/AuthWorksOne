// Connector Hub UI (apps/hub/ui) and reference-app flows used across specs.
import { expect } from '@playwright/test';
import { MOCK_INTERNAL, URLS, control, expectAudit, record } from '../lib/stack.js';
import { logto } from './logto.js';

// Signs in to an app (reference app by default) through Logto; silent when a Logto session exists.
export const appSignIn = async (page, user, base = URLS.rp) => {
  await page.goto(`${base}/login`);
  await page.waitForURL((url) => url.origin === base || url.pathname.startsWith('/sign-in'));
  if (new URL(page.url()).origin !== base) await logto.signIn(page, user);
  await page.waitForURL(`${base}/`);
};

// Opens the Hub UI, signing in when needed (the SPA redirects to /login client-side).
export const hubOpen = async (page, user, path = '/connections') => {
  await page.goto(`${URLS.hub}${path}`);
  const signedIn = page.getByRole('link', { name: 'Sign out' });
  await expect(signedIn.or(page.locator('input[name=identifier]'))).toBeVisible();
  if (!(await signedIn.isVisible())) {
    await logto.signIn(page, user);
    await expect(signedIn).toBeVisible();
  }
};

const card = (page, label) => page.locator('li.card', { hasText: label });
export const expectStatus = (page, label, status) => expect(card(page, label).getByText(status, { exact: true })).toBeVisible();

const openAdd = async (page, serviceName, label) => {
  await page.goto(`${URLS.hub}/connections`);
  await page.getByRole('button', { name: 'Add connection' }).click();
  await page.locator('#connector').selectOption({ label: serviceName });
  await page.locator('#label').fill(label);
};

// OAuth connector (mock provider auto-approves). Returns the connection id.
export const connectOAuth = async (page, sub, { service = 'HubSpot (mock)', label = `HubSpot ${Date.now()}` } = {}) => {
  await openAdd(page, service, label);
  await page.getByRole('button', { name: `Continue to ${service}` }).click();
  await page.waitForURL(`${URLS.hub}/connections?**`);
  await expectStatus(page, label, 'Active');
  expectAudit({ event: 'connection.create', sub });
  return connectionId(page, label);
};

// WordPress (app password form) against the mock site.
export const connectWordPress = async (page, sub, label = `WP ${Date.now()}`) => {
  const username = `wp${Date.now()}`;
  const appPassword = `${Math.random().toString(36).slice(2, 6)} ${Math.random().toString(36).slice(2, 6)} ${Math.random().toString(36).slice(2, 6)}`;
  await control('app-password', { user: username, password: appPassword });
  record('secret', appPassword.replace(/\s+/g, ''));
  await openAdd(page, 'WordPress (self-hosted)', label);
  await page.locator('#siteUrl').fill(MOCK_INTERNAL);
  await page.locator('#username').fill(username);
  await page.locator('#appPassword').fill(appPassword);
  await page.getByRole('button', { name: 'Save' }).click();
  await expectStatus(page, label, 'Active');
  expectAudit({ event: 'connection.create', sub });
  return connectionId(page, label);
};

// Connection id by label, from the session UI API.
export const connectionId = async (page, label) => {
  const res = await page.request.get(`${URLS.hub}/ui-api/connections`);
  const body = await res.json();
  return body.data.find((c) => c.label === label).id;
};

// On the Hub consent page: allow the app (first usable connection is preselected or chosen).
export const allowConsent = async (page, appName) => {
  await page.waitForURL(`${URLS.hub}/consent?**`);
  await expect(page.getByRole('heading', { name: `Allow ${appName}?` })).toBeVisible();
  const radio = page.locator('input[name=connection]').first();
  if (!(await radio.isChecked())) await radio.check();
  await page.getByRole('button', { name: 'Allow' }).click();
};
