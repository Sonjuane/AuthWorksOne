// S9: an admin assigns a role through config/provision (roleAssignments -> OWNER_EMAILS); the next
// access token carries it.
import { execFileSync } from 'node:child_process';
import { test, expect } from './fixtures.js';
import { repo } from './lib/stack.js';
import { appSignIn } from './pages/hub.js';

const roles = (page) => page.getByRole('row', { name: /^roles/ }).getByRole('cell').nth(1);

test('S9: role assigned by provision appears in the next access token', async ({ page, user }) => {
  await appSignIn(page, user);
  await expect(roles(page)).toHaveText('user');

  execFileSync(process.execPath, ['--env-file=.env.test', 'scripts/provision.js'], {
    cwd: repo, env: { ...process.env, OWNER_EMAILS: user.email }, stdio: ['ignore', 'ignore', 'inherit'],
  });
  await page.getByRole('link', { name: 'Re-issue tokens (SSO)' }).click();
  await expect(roles(page)).toHaveText(/\bowner\b/);
});
