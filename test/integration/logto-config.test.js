// Phase 1 integration tests against the live Logto tenant: provisioning idempotency (S20) and
// that the applied tenant state matches config/sso.config.json. Run: npm run test:int
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { decodeJwt } from 'jose';
import { api } from '../../scripts/lib/logto.js';
import { accountApi, createClient } from '../../scripts/lib/experience.js';

const config = JSON.parse(readFileSync(new URL('../../config/sso.config.json', import.meta.url)));
const provision = (env = {}) =>
  promisify(execFile)(process.execPath, ['--env-file=.env', 'scripts/provision.js'], {
    cwd: new URL('../..', import.meta.url),
    env: { ...process.env, ...env },
  });
const rp = config.applications.find((a) => a.key === 'sample-rp');
const client = createClient({ clientId: process.env.SAMPLE_RP_CLIENT_ID, clientSecret: process.env.SAMPLE_RP_CLIENT_SECRET, redirectUri: rp.redirectUris[0] });
const cleanups = [];
after(async () => { for (const fn of cleanups.reverse()) await fn(); });

// Throwaway user, deleted after the run.
const newUser = async (tag) => {
  const password = `It!${randomBytes(9).toString('base64url')}9a`;
  const customData = Object.fromEntries(config.customProfileFields.filter((f) => f.required).map((f) => [f.name, 'Integration']));
  const user = await api('POST', '/api/users', { primaryEmail: `it-${tag}-${Date.now()}@example.com`, password, customData });
  cleanups.push(() => api('DELETE', `/api/users/${user.id}`));
  return { ...user, password };
};
const resourceRoles = async (user) => {
  const { tokens, error } = await client.signIn(user.primaryEmail, user.password, { scope: 'openid offline_access profile', resource: rp.resource });
  assert.ok(tokens, `sign-in failed: ${error}`);
  const jwt = await client.token({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, resource: rp.resource });
  return { tokens, roles: decodeJwt(jwt.data.access_token).roles };
};

test('provision twice: second run reports no creates (S20, NF-10)', async () => {
  await provision();
  const { stdout } = await provision();
  assert.deepEqual(stdout.split('\n').filter((line) => /^\s+\+/.test(line)), []);
});

test('sign-in experience matches config (ID-02, ID-03, ID-04, ID-05, ID-11, LV-05)', async () => {
  const sie = await api('GET', '/api/sign-in-exp');
  const wanted = config.signInExperience;
  for (const key of ['mfa', 'sentinelPolicy', 'socialSignIn', 'forgotPasswordMethods', 'branding', 'customCss']) {
    assert.deepEqual(sie[key], wanted[key], key);
  }
});

test('account center exposes MFA and sessions (ID-04, LV-04)', async () => {
  const { fields } = await api('GET', '/api/account-center');
  for (const [field, value] of Object.entries(config.accountCenter.fields)) assert.equal(fields[field], value, field);
});

test('roles carry their permissions; `user` is the default (ID-07, ID-08)', async () => {
  const resources = await api('GET', '/api/resources');
  const roles = await api('GET', '/api/roles?page_size=100');
  for (const wanted of config.roles) {
    const role = roles.find((r) => r.name === wanted.name);
    assert.ok(role, wanted.name);
    assert.equal(role.isDefault, wanted.isDefault ?? false, `${wanted.name} isDefault`);
    const scopes = await api('GET', `/api/roles/${role.id}/scopes`);
    for (const { resource, scopes: names } of wanted.permissions) {
      const resourceId = resources.find((r) => r.indicator === resource).id;
      for (const name of names) assert.ok(scopes.some((s) => s.name === name && s.resourceId === resourceId), `${wanted.name}: ${name}`);
    }
  }
});

test('applications have exact URIs and refresh-token rotation (ID-09)', async () => {
  const applications = await api('GET', '/api/applications');
  for (const wanted of config.applications.filter((a) => a.customClientMetadata && !a.profiles)) {
    const app = applications.find((a) => a.name === wanted.name);
    assert.deepEqual(app.oidcClientMetadata.redirectUris, wanted.redirectUris, wanted.name);
    assert.deepEqual(
      { rotateRefreshToken: app.customClientMetadata.rotateRefreshToken, refreshTokenTtlInDays: app.customClientMetadata.refreshTokenTtlInDays },
      wanted.customClientMetadata,
      wanted.name
    );
  }
});

test('User.Deleted webhook is provisioned (VA-08 prerequisite)', async () => {
  const hooks = await api('GET', '/api/hooks');
  for (const wanted of config.hooks) {
    const hook = hooks.find((h) => h.name === wanted.name);
    assert.ok(hook, wanted.name);
    assert.deepEqual(hook.events, wanted.events);
    assert.equal(hook.config.url, wanted.url);
  }
});

test('new users get the default role; tokens carry `roles`; timezone via Account API (ID-06, ID-07)', async () => {
  const user = await newUser('default');
  const { tokens, roles } = await resourceRoles(user);
  assert.deepEqual(roles, ['user']);

  const updated = await accountApi(tokens.access_token, 'PATCH', '/api/my-account/profile', { zoneinfo: 'Europe/London' });
  assert.equal(updated.status, 200, JSON.stringify(updated.data));
  assert.equal((await api('GET', `/api/users/${user.id}`)).profile.zoneinfo, 'Europe/London');
});

test('role assigned via config + provision appears in the next token (S9)', async () => {
  const user = await newUser('owner');
  const assignment = config.roleAssignments[0];
  const first = await provision({ [assignment.emailsEnv]: user.primaryEmail });
  assert.match(first.stdout, new RegExp(`\\+ ${assignment.role} -> ${user.primaryEmail}`));
  const second = await provision({ [assignment.emailsEnv]: user.primaryEmail });
  assert.match(second.stdout, new RegExp(`= ${assignment.role} -> ${user.primaryEmail}`));
  assert.deepEqual((await resourceRoles(user)).roles.sort(), [assignment.role, 'user'].sort());
});
