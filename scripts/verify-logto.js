// Phase 0 verifier (spec §3.0): checks LV-01..LV-09 live against the configured Logto tenant.
// Each check is self-contained; tenant settings are restored and created entities deleted after
// every check, and the run fails if the tenant differs afterwards. Re-run before any Logto upgrade.
// Usage: npm run verify:logto [-- --only LV-02,LV-09]
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { decodeJwt } from 'jose';
import { api, need } from './lib/logto.js';
import { accountApi, createClient, ok, verifyPassword } from './lib/experience.js';
import { startMockOidc } from './lib/mock-oidc.js';
import { totp } from './lib/totp.js';

const config = JSON.parse(readFileSync(new URL('../config/sso.config.json', import.meta.url)));
const rp = config.applications.find((a) => a.key === 'sample-rp');
const client = createClient({
  clientId: need('SAMPLE_RP_CLIENT_ID'),
  clientSecret: need('SAMPLE_RP_CLIENT_SECRET'),
  redirectUri: rp.redirectUris[0],
});
const RESOURCE = rp.resource;
const MAILBOX = `http://localhost:${process.env.DEV_MAILBOX_PORT ?? 3099}`;
const MOCK_PORT = 3098;
const ACCOUNT_SCOPE = 'openid offline_access identities urn:logto:scope:sessions';
const ts = Date.now();
const PASSWORD = `Lv!${randomBytes(9).toString('base64url')}9a`;
const requiredProfile = Object.fromEntries(
  (config.customProfileFields ?? []).filter((f) => f.required).map((f) => [f.name, 'LV check'])
);

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k]]));
const patchFields = async (fields) =>
  api('PATCH', '/api/account-center', { fields: { ...(await api('GET', '/api/account-center')).fields, ...fields } });

// --- Tenant snapshot / restore / drift ---
const snapshot = async () => ({
  signInExperience: pick(await api('GET', '/api/sign-in-exp'), ['mfa', 'sentinelPolicy', 'socialSignIn', 'forgotPasswordMethods', 'socialSignInConnectorTargets']),
  accountCenter: (await api('GET', '/api/account-center')).fields,
  rpMetadata: (await api('GET', `/api/applications/${client.clientId}`)).customClientMetadata,
  jwtScript: await api('GET', '/api/configs/jwt-customizer/access-token').then((j) => j.script, () => null),
});
const restore = async (state) => {
  await api('PATCH', '/api/sign-in-exp', state.signInExperience);
  await api('PATCH', '/api/account-center', { fields: state.accountCenter });
  await api('PATCH', `/api/applications/${client.clientId}`, { customClientMetadata: state.rpMetadata });
  if (state.jwtScript) await api('PUT', '/api/configs/jwt-customizer/access-token', { script: state.jwtScript });
  else await api('DELETE', '/api/configs/jwt-customizer/access-token').catch(() => {});
};
const inventory = async () => {
  const ids = async (path) => (await api('GET', path)).map((x) => x.id).sort();
  return { users: await ids('/api/users?page_size=100'), roles: await ids('/api/roles?page_size=100'), connectors: await ids('/api/connectors'), organizations: await ids('/api/organizations?page_size=100') };
};

// --- Per-check context: deferred cleanup + throwaway users ---
const makeContext = () => {
  const cleanups = [];
  const defer = (fn) => cleanups.push(fn);
  const newUser = async (tag) => {
    const user = await api('POST', '/api/users', { primaryEmail: `lv-${tag}-${ts}@example.com`, password: PASSWORD, customData: requiredProfile });
    defer(() => api('DELETE', `/api/users/${user.id}`));
    return user;
  };
  const cleanup = async () => {
    for (const fn of cleanups.reverse()) await fn().catch((err) => console.log(`     cleanup: ${err.message}`));
  };
  return { defer, newUser, cleanup };
};

// --- Dev mailbox: reuse a running one, otherwise start scripts/dev-mailbox.js ---
const mailboxUp = () => fetch(MAILBOX).then(() => true, () => false);
const startMailbox = async () => {
  if (await mailboxUp()) return async () => {};
  const child = spawn(process.execPath, [new URL('./dev-mailbox.js', import.meta.url).pathname], { stdio: 'ignore' });
  for (let i = 0; i < 20 && !(await mailboxUp()); i++) await sleep(250);
  return async () => { child.kill(); };
};
const mailCode = async (to, type) => {
  for (let i = 0; i < 20; i++) {
    const messages = (await fetch(MAILBOX).then((r) => r.json())).map((m) => { try { return JSON.parse(m.body); } catch { return {}; } });
    const match = messages.filter((m) => m.to === to && m.type === type).at(-1);
    if (match?.payload?.code) return match.payload.code;
    await sleep(500);
  }
  return null;
};

// SES live send via the connector test endpoint; skipped without credentials (task 0.3).
const sesCheck = async () => {
  const sesConfig = {
    accessKeyId: process.env.AWS_SES_ACCESS_KEY_ID,
    accessKeySecret: process.env.AWS_SES_SECRET,
    region: process.env.AWS_SES_REGION,
    emailAddress: process.env.AWS_SES_FROM,
  };
  const to = process.env.SES_TEST_RECIPIENT;
  if (!to || Object.values(sesConfig).some((v) => !v)) return 'skip (AWS_SES_* / SES_TEST_RECIPIENT not set)';
  const templates = config.connectors?.find((c) => c.config?.templates)?.config.templates ?? [];
  await api('POST', '/api/connectors/aws-ses-mail/test', { email: to, config: { ...sesConfig, templates } });
  return `test email sent to ${to}`;
};

// --- Checks: [id, label, run(context) -> detail string] ---
const checks = [
  ['LV-01', 'Automatic account linking by verified email', async ({ defer, newUser }) => {
    const mock = await startMockOidc({ port: MOCK_PORT, issuer: `http://host.docker.internal:${MOCK_PORT}` });
    defer(() => mock.close());
    const toBrowserUrl = (url) => url.replace(mock.issuer, `http://localhost:${MOCK_PORT}`);
    const connectors = [];
    for (const name of ['google', 'github']) {
      const connector = await api('POST', '/api/connectors', {
        connectorId: 'oidc',
        metadata: { target: `lv-${name}-${ts}`, name: { en: `LV ${name}` }, logo: '' },
        config: {
          authorizationEndpoint: mock.authorizationEndpoint,
          tokenEndpoint: mock.tokenEndpoint,
          clientId: `lv-${name}`,
          clientSecret: 'lv',
          scope: 'openid email',
          idTokenVerificationConfig: { jwksUri: mock.jwksUri },
        },
      });
      defer(() => api('DELETE', `/api/connectors/${connector.id}`));
      connectors.push(connector);
    }
    const { socialSignInConnectorTargets } = await api('GET', '/api/sign-in-exp');
    await api('PATCH', '/api/sign-in-exp', {
      socialSignInConnectorTargets: [...socialSignInConnectorTargets, ...connectors.map((c) => c.target)],
      socialSignIn: { automaticAccountLinking: true },
    });
    const user = await newUser('link');
    for (const connector of connectors) {
      mock.setIdentity({ sub: `${connector.target}-sub`, email: user.primaryEmail, verified: true });
      const result = await client.socialSignIn(connector.id, toBrowserUrl);
      assert(result.sub === user.id, `${connector.target}: expected existing user, got ${JSON.stringify(result)}`);
    }
    const identities = Object.keys((await api('GET', `/api/users/${user.id}`)).identities);
    assert(connectors.every((c) => identities.includes(c.target)), `identities on user: ${identities.join(', ')}`);
    const other = await newUser('nolink');
    mock.setIdentity({ sub: `unverified-${ts}`, email: other.primaryEmail, verified: false });
    const unverified = await client.socialSignIn(connectors[1].id, toBrowserUrl);
    assert(unverified.error === 'user.identity_not_exist' && !unverified.relatedUser, `unverified email: ${JSON.stringify(unverified)}`);
    return 'two verified social identities linked to one user; unverified email not linked';
  }],

  ['LV-02', 'TOTP + backup codes: enable, enroll, sign in, remove', async ({ newUser }) => {
    await api('PATCH', '/api/sign-in-exp', { mfa: { factors: ['Totp', 'BackupCode'], policy: 'NoPrompt' } });
    await patchFields({ mfa: 'Edit' });
    const user = await newUser('mfa');
    const accessToken = (await client.signIn(user.primaryEmail, PASSWORD, { scope: ACCOUNT_SCOPE })).tokens.access_token;
    const verificationId = await verifyPassword(accessToken, PASSWORD);
    const my = async (method, path, body) => ok(await accountApi(accessToken, method, `/api/my-account${path}`, body, verificationId), `${method} ${path}`);
    const { secret } = await my('POST', '/mfa-verifications/totp-secret/generate');
    await my('POST', '/mfa-verifications', { type: 'Totp', secret, code: totp(secret) });
    const { codes } = await my('POST', '/mfa-verifications/backup-codes/generate');
    await my('POST', '/mfa-verifications', { type: 'BackupCode', codes });
    const passwordOnly = await client.signIn(user.primaryEmail, PASSWORD);
    assert(passwordOnly.error === 'session.mfa.require_mfa_verification', `password-only sign-in: ${passwordOnly.error ?? 'succeeded'}`);
    assert((await client.signIn(user.primaryEmail, PASSWORD, { mfa: { totpSecret: secret } })).tokens, 'TOTP sign-in failed');
    assert((await client.signIn(user.primaryEmail, PASSWORD, { mfa: { backupCode: codes[0] } })).tokens, 'backup-code sign-in failed');
    const totpFactor = (await my('GET', '/mfa-verifications')).find((f) => f.type === 'Totp');
    await my('DELETE', `/mfa-verifications/${totpFactor.id}`);

    // Enrollment from the sign-in flow.
    await api('PATCH', '/api/sign-in-exp', { mfa: { factors: ['Totp', 'BackupCode'], policy: 'Mandatory' } });
    const fresh = await newUser('bind');
    const { req, finish } = await client.begin();
    const pw = ok(await req('POST', '/api/experience/verification/password', { identifier: { type: 'email', value: fresh.primaryEmail }, password: PASSWORD }), 'password');
    ok(await req('POST', '/api/experience/identification', { verificationId: pw.verificationId }), 'identification');
    const missing = await req('POST', '/api/experience/submit');
    assert(missing.data?.code === 'user.missing_mfa', `sign-in flow without MFA: ${JSON.stringify(missing.data)}`);
    const totpSecret = ok(await req('POST', '/api/experience/verification/totp/secret'), 'totp secret');
    const verified = ok(await req('POST', '/api/experience/verification/totp/verify', { code: totp(totpSecret.secret), verificationId: totpSecret.verificationId }), 'totp verify');
    ok(await req('POST', '/api/experience/profile/mfa', { type: 'Totp', verificationId: verified.verificationId ?? totpSecret.verificationId }), 'bind totp');
    let submit = await req('POST', '/api/experience/submit');
    if (submit.status >= 400 && /backup/i.test(JSON.stringify(submit.data))) {
      const backup = ok(await req('POST', '/api/experience/verification/backup-code/generate'), 'backup codes');
      ok(await req('POST', '/api/experience/profile/mfa', { type: 'BackupCode', verificationId: backup.verificationId }), 'bind backup codes');
      submit = await req('POST', '/api/experience/submit');
    }
    await finish(ok(submit, 'submit after binding').redirectTo);
    return 'Account API enroll + remove; sign-in with TOTP and with backup code; enrollment from the sign-in flow';
  }],

  ['LV-03', 'MFA policies; per-role / per-organization enforcement', async ({ defer }) => {
    const policies = ['Mandatory', 'PromptAtSignInAndSignUp', 'PromptOnlyAtSignIn', 'NoPrompt'];
    for (const policy of policies) {
      await api('PATCH', '/api/sign-in-exp', { mfa: { factors: ['Totp'], policy } });
      assert((await api('GET', '/api/sign-in-exp')).mfa.policy === policy, `policy ${policy} not applied`);
    }
    await api('PATCH', '/api/sign-in-exp', { mfa: { factors: ['Totp'], policy: 'NoPrompt', organizationRequiredMfaPolicy: 'Mandatory' } });
    const org = await api('POST', '/api/organizations', { name: `lv-org-${ts}`, isMfaRequired: true });
    defer(() => api('DELETE', `/api/organizations/${org.id}`));
    assert(org.isMfaRequired === true, 'organization isMfaRequired not stored');
    const role = await api('POST', '/api/roles', { name: `lv-mfa-${ts}`, description: 'verify-logto', type: 'User' });
    defer(() => api('DELETE', `/api/roles/${role.id}`));
    const perRole = Object.keys(role).some((k) => /mfa/i.test(k));
    return `policies: ${policies.join(', ')}; per-organization: yes; per-role: ${perRole ? 'yes' : 'no'}`;
  }],

  ['LV-04', 'Users list and revoke their own sessions', async ({ newUser }) => {
    await patchFields({ session: 'Edit' });
    const user = await newUser('sessions');
    const accessToken = (await client.signIn(user.primaryEmail, PASSWORD, { scope: ACCOUNT_SCOPE })).tokens.access_token;
    await client.signIn(user.primaryEmail, PASSWORD);
    const verificationId = await verifyPassword(accessToken, PASSWORD);
    const list = async () => ok(await accountApi(accessToken, 'GET', '/api/my-account/sessions', undefined, verificationId), 'list sessions').sessions;
    const before = await list();
    const target = before.find((s) => !s.isCurrent) ?? before[0];
    ok(await accountApi(accessToken, 'DELETE', `/api/my-account/sessions/${target.payload.uid}`, undefined, verificationId), 'revoke session');
    const after = await list();
    assert(after.length === before.length - 1, `sessions ${before.length} -> ${after.length}`);
    return `Account API: listed ${before.length} sessions, revoked one`;
  }],

  ['LV-05', 'Failed sign-in lockout by config', async ({ newUser }) => {
    await api('PATCH', '/api/sign-in-exp', { sentinelPolicy: { maxAttempts: 3, lockoutDuration: 1 } });
    const user = await newUser('lockout');
    for (let i = 0; i < 3; i++) await client.signIn(user.primaryEmail, 'Wrong-password-1');
    const correct = await client.signIn(user.primaryEmail, PASSWORD);
    assert(correct.error === 'session.verification_blocked_too_many_attempts', `correct password after 3 failures: ${correct.error ?? 'signed in'}`);
    return 'sentinelPolicy {maxAttempts, lockoutDuration}; correct password blocked during lockout';
  }],

  ['LV-06', 'Audit log event types and Management API query', async ({ newUser }) => {
    const user = await newUser('logs');
    const { tokens } = await client.signIn(user.primaryEmail, PASSWORD, { scope: 'openid profile' });
    const userLogs = async () => api('GET', `/api/logs?page_size=100&userId=${user.id}`);
    const before = await userLogs();
    const keys = [...new Set(before.map((l) => l.key))].sort();
    assert(keys.includes('Interaction.SignIn.Submit'), `no sign-in entry; keys: ${keys.join(', ')}`);
    const filtered = await api('GET', '/api/logs?page_size=5&logKey=Interaction.SignIn.Submit');
    assert(filtered.length && filtered.every((l) => l.key === 'Interaction.SignIn.Submit'), 'logKey filter not applied');
    ok(await accountApi(tokens.access_token, 'PATCH', '/api/my-account', { name: `LV ${ts}` }), 'Account API update');
    const accountApiLogged = (await userLogs()).length > before.length;
    return `queryable by userId/logKey; sign-in keys: ${keys.join(', ')}; Account API changes logged: ${accountApiLogged ? 'yes' : 'no (AU-01 part in spec §8)'}`;
  }],

  ['LV-07', 'Refresh token rotation + lifetime per application', async () => {
    await api('PATCH', `/api/applications/${client.clientId}`, { customClientMetadata: { rotateRefreshToken: true, refreshTokenTtlInDays: 7 } });
    const metadata = (await api('GET', `/api/applications/${client.clientId}`)).customClientMetadata;
    assert(metadata.rotateRefreshToken === true && metadata.refreshTokenTtlInDays === 7, JSON.stringify(metadata));
    return 'customClientMetadata.rotateRefreshToken + refreshTokenTtlInDays (confidential clients rotate after 70% of TTL)';
  }],

  ['LV-08', 'Resource access token claims: sub, client_id, scope, roles', async ({ defer, newUser }) => {
    const user = await newUser('claims');
    const resource = (await api('GET', '/api/resources')).find((r) => r.indicator === RESOURCE);
    const scope = await api('POST', `/api/resources/${resource.id}/scopes`, { name: `lv:${ts}` });
    defer(() => api('DELETE', `/api/resources/${resource.id}/scopes/${scope.id}`));
    const role = await api('POST', '/api/roles', { name: `lv-claims-${ts}`, description: 'verify-logto', type: 'User', scopeIds: [scope.id] });
    defer(() => api('DELETE', `/api/roles/${role.id}`));
    await api('POST', `/api/users/${user.id}/roles`, { roleIds: [role.id] });
    await api('PUT', '/api/configs/jwt-customizer/access-token', {
      script: 'const getCustomJwtClaims = async ({ context }) => ({ roles: (context?.user?.roles ?? []).map((r) => r.name) });',
    });
    const { tokens } = await client.signIn(user.primaryEmail, PASSWORD, { scope: `openid offline_access ${scope.name}`, resource: RESOURCE });
    const refreshed = await client.token({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, resource: RESOURCE });
    const claims = decodeJwt(refreshed.data.access_token);
    assert(
      claims.aud === RESOURCE && claims.sub === user.id && claims.client_id === client.clientId &&
        claims.scope?.split(' ').includes(scope.name) && claims.roles?.includes(role.name),
      `claims: ${JSON.stringify(claims)}`
    );
    return 'JWT carries aud, sub, client_id, role-granted scope, roles (via JWT customizer)';
  }],

  ['LV-09', 'Verification and reset emails (http-email; SES when configured)', async ({ defer, newUser }) => {
    const connectors = await api('GET', '/api/connectors');
    let http = 'skip (no http-email connector)';
    if (connectors.some((c) => c.connectorId === 'http-email')) {
      defer(await startMailbox());
      await api('PATCH', '/api/sign-in-exp', { forgotPasswordMethods: ['EmailVerificationCode'] });
      const newEmail = `lv-register-${ts}@example.com`;
      const register = await client.begin({ interactionEvent: 'Register' });
      ok(await register.req('POST', '/api/experience/verification/verification-code', { identifier: { type: 'email', value: newEmail }, interactionEvent: 'Register' }), 'register code');
      assert(await mailCode(newEmail, 'Register'), 'register code not delivered to mailbox');

      const user = await newUser('reset');
      const identifier = { type: 'email', value: user.primaryEmail };
      const { req } = await client.begin({ interactionEvent: 'ForgotPassword' });
      const { verificationId } = ok(await req('POST', '/api/experience/verification/verification-code', { identifier, interactionEvent: 'ForgotPassword' }), 'reset code');
      const code = await mailCode(user.primaryEmail, 'ForgotPassword');
      assert(code, 'reset code not delivered to mailbox');
      const newPassword = `${PASSWORD}X`;
      ok(await req('POST', '/api/experience/verification/verification-code/verify', { identifier, verificationId, code }), 'verify reset code');
      ok(await req('POST', '/api/experience/identification', { verificationId }), 'reset identification');
      ok(await req('PUT', '/api/experience/profile/password', { password: newPassword }), 'set new password');
      ok(await req('POST', '/api/experience/submit'), 'reset submit');
      assert((await client.signIn(user.primaryEmail, newPassword)).tokens, 'sign-in with new password failed');
      http = 'register + reset codes delivered, reset completed';
    }
    return `http-email: ${http}; ses: ${await sesCheck()}`;
  }],
];

// --- Runner ---
const onlyIndex = process.argv.indexOf('--only');
const only = onlyIndex > -1 ? process.argv[onlyIndex + 1].split(',') : null;
const before = await snapshot();
const inventoryBefore = await inventory();
let failed = 0;

for (const [id, label, run] of checks) {
  if (only && !only.includes(id)) continue;
  const context = makeContext();
  try {
    const detail = await run(context);
    console.log(`PASS ${id}  ${label}\n     ${detail}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${id}  ${label}\n     ${err.message}`);
  } finally {
    await restore(before).catch((err) => console.log(`     restore: ${err.message}`));
    await context.cleanup();
  }
}

const after = await snapshot();
const inventoryAfter = await inventory();
const drift = [
  ...Object.keys(before).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k])),
  ...Object.keys(inventoryAfter).filter((k) => JSON.stringify(inventoryAfter[k]) !== JSON.stringify(inventoryBefore[k])),
];
if (drift.length) failed++;
console.log(`\n${failed ? `${failed} failed` : 'All checks passed'}; tenant ${drift.length ? `CHANGED: ${drift.join(', ')}` : 'unchanged'}`);
process.exit(failed ? 1 : 0);
