// Extra (UI-06): at 375 px every Hub page fits without horizontal scroll, and the primary color is
// the config's signInExperience.color.primaryColor.
import { test, expect } from './fixtures.js';
import { URLS, clientId, sso } from './lib/stack.js';
import { hubOpen } from './pages/hub.js';

test.use({ viewport: { width: 375, height: 812 } });

const hexToRgb = (hex) => `rgb(${hex.slice(1).match(/../g).map((h) => parseInt(h, 16)).join(', ')})`;

test('Hub UI at 375 px: no horizontal scroll; brand primary color', async ({ page, user }) => {
  await hubOpen(page, user);
  const paths = ['/connections', '/apps', '/account', `/consent?client_id=${clientId('sample-rp')}&connector=hubspot`];
  for (const path of paths) {
    await page.goto(`${URLS.hub}${path}`);
    await expect(page.getByRole('link', { name: 'Sign out' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(scroll, path).toBeLessThanOrEqual(client);
  }
  await page.goto(`${URLS.hub}/connections`);
  const color = await page.getByRole('button', { name: 'Add connection' }).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(color).toBe(hexToRgb(sso.signInExperience.color.primaryColor));
});
