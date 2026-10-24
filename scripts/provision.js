// Idempotent config-as-code: applies config/sso.config.json to Logto via the Management API.
// Safe to re-run; "+" = created, "=" = exists/updated, "-" = skipped.
// SSO_PROFILE (default `dev`) selects entries tagged with `profiles`.
import { readFileSync, writeFileSync } from 'node:fs';
import { api, endpoint } from './lib/logto.js';
import { accessTokenScript } from './lib/jwt-script.js';

const config = JSON.parse(readFileSync(new URL('../config/sso.config.json', import.meta.url)));
const PROFILE = process.env.SSO_PROFILE ?? 'dev';
const log = (msg) => console.log(`  ${msg}`);
const step = (msg) => console.log(`\n${msg}`);
const inProfile = (entry) => !entry.profiles || entry.profiles.includes(PROFILE);

// Collects every page of a paginated Management API list.
const listAll = async (path) => {
  const items = [];
  for (let page = 1; ; page++) {
    const batch = await api('GET', `${path}${path.includes('?') ? '&' : '?'}page=${page}&page_size=100`);
    items.push(...batch);
    if (batch.length < 100) return items;
  }
};

// configEnv field -> env var; null when any env var is empty. Static `config` is merged over.
const resolveConfig = (configEnv = {}, staticConfig = {}) => {
  const resolved = {};
  for (const [field, envVar] of Object.entries(configEnv)) {
    if (!process.env[envVar]) return null;
    resolved[field] = process.env[envVar];
  }
  return { ...resolved, ...staticConfig };
};
const missingEnv = (configEnv = {}) => Object.values(configEnv).filter((envVar) => !process.env[envVar]);

console.log(`Profile: ${PROFILE}`);

// --- Resources + scopes ---
step('API resources');
const resources = await api('GET', '/api/resources');
const scopeIds = new Map(); // "<indicator> <scope>" -> scope id
for (const { scopes = [], ...wanted } of config.resources ?? []) {
  let resource = resources.find((r) => r.indicator === wanted.indicator);
  if (resource) log(`= ${wanted.indicator}`);
  else {
    resource = await api('POST', '/api/resources', wanted);
    log(`+ ${wanted.indicator}`);
  }
  const existing = await listAll(`/api/resources/${resource.id}/scopes`);
  for (const scope of scopes) {
    let found = existing.find((s) => s.name === scope.name);
    if (found) log(`= ${wanted.indicator} ${scope.name}`);
    else {
      found = await api('POST', `/api/resources/${resource.id}/scopes`, scope);
      log(`+ ${wanted.indicator} ${scope.name}`);
    }
    scopeIds.set(`${wanted.indicator} ${scope.name}`, found.id);
  }
}

// --- Roles (global) + permissions + default-role backfill ---
step('Roles');
const roles = await listAll('/api/roles');
const roleIds = new Map(roles.map((r) => [r.name, r.id]));
for (const wanted of config.roles ?? []) {
  const wantedScopeIds = (wanted.permissions ?? []).flatMap(({ resource, scopes }) =>
    scopes.map((name) => {
      const id = scopeIds.get(`${resource} ${name}`);
      if (!id) throw new Error(`Role ${wanted.name}: scope "${name}" is not declared on resource ${resource}`);
      return id;
    })
  );
  const isDefault = wanted.isDefault ?? false;
  const found = roles.find((r) => r.name === wanted.name);
  if (found) {
    await api('PATCH', `/api/roles/${found.id}`, { description: wanted.description, isDefault });
    const current = new Set((await listAll(`/api/roles/${found.id}/scopes`)).map((s) => s.id));
    const missing = wantedScopeIds.filter((id) => !current.has(id));
    if (missing.length) await api('POST', `/api/roles/${found.id}/scopes`, { scopeIds: missing });
    log(`= ${wanted.name}${missing.length ? ` (${missing.length} permission(s) added)` : ''}`);
  } else {
    const role = await api('POST', '/api/roles', { name: wanted.name, description: wanted.description, type: 'User', isDefault, scopeIds: wantedScopeIds });
    roleIds.set(wanted.name, role.id);
    log(`+ ${wanted.name}`);
  }
}
// Logto assigns default roles only at user creation; give them to existing users that have none.
const defaultRoleIds = (config.roles ?? []).filter((r) => r.isDefault).map((r) => roleIds.get(r.name));
if (defaultRoleIds.length) {
  let backfilled = 0;
  for (const user of await listAll('/api/users')) {
    if ((await api('GET', `/api/users/${user.id}/roles`)).length) continue;
    await api('POST', `/api/users/${user.id}/roles`, { roleIds: defaultRoleIds });
    backfilled++;
  }
  log(backfilled ? `+ default role(s) given to ${backfilled} existing user(s) without roles` : '= every user has a role');
}

// --- Social connectors (secrets from env; skipped when env is empty or out of profile) ---
step('Connectors');
let connectors = await api('GET', '/api/connectors');
const applyConnector = async ({ connectorId, metadata }, connectorConfig, note = '') => {
  const label = `${metadata ? `${connectorId}/${metadata.target}` : connectorId}${note}`;
  const body = { config: connectorConfig, ...(metadata ? { metadata: { target: metadata.target, name: { en: metadata.name }, logo: '' } } : {}) };
  const found = connectors.find((c) => c.connectorId === connectorId && (!metadata || c.target === metadata.target));
  if (found) {
    await api('PATCH', `/api/connectors/${found.id}`, body);
    log(`= ${label}`);
  } else {
    await api('POST', '/api/connectors', { connectorId, ...body });
    log(`+ ${label}`);
  }
};
for (const wanted of config.connectors ?? []) {
  const label = wanted.metadata ? `${wanted.connectorId}/${wanted.metadata.target}` : wanted.connectorId;
  if (!inProfile(wanted)) {
    log(`- ${label} (profile ${wanted.profiles.join('/')})`);
    continue;
  }
  const connectorConfig = resolveConfig(wanted.configEnv, wanted.config);
  if (!connectorConfig) {
    log(`- ${label} (env vars not set: ${missingEnv(wanted.configEnv).join(', ')})`);
    continue;
  }
  await applyConnector(wanted, connectorConfig);
}

// --- Email: one connector, chosen by EMAIL_PROVIDER ?? email.provider; dev fallback when env is incomplete ---
if (config.email) {
  step('Email');
  connectors = await api('GET', '/api/connectors');
  const { email } = config;
  const providerName = process.env.EMAIL_PROVIDER ?? email.provider;
  const provider = email.providers[providerName];
  if (!provider) throw new Error(`email.provider "${providerName}" is not defined in email.providers`);
  const providerConfig = resolveConfig(provider.configEnv, provider.config);
  let chosen = { connectorId: provider.connectorId, config: providerConfig && { ...providerConfig, ...(provider.templates ? { templates: email.templates } : {}) } };
  let note = ` (${providerName})`;
  if (!providerConfig) {
    log(`- ${providerName} (env vars not set: ${missingEnv(provider.configEnv).join(', ')})`);
    chosen = email.devFallback;
    note = ' (dev fallback)';
  }
  await applyConnector({ connectorId: chosen.connectorId }, chosen.config, note);
  for (const other of connectors.filter((c) => c.type === 'Email' && c.connectorId !== chosen.connectorId)) {
    await api('DELETE', `/api/connectors/${other.id}`);
    log(`- ${other.connectorId} (removed; email now uses ${chosen.connectorId})`);
  }
}
connectors = await api('GET', '/api/connectors');

// --- Sign-in experience ---
step('Sign-in experience');
const sie = structuredClone(config.signInExperience);
// Branding: drop unset asset URLs so an empty logo/favicon doesn't fail Logto's URL validation.
if (sie.branding) {
  sie.branding = Object.fromEntries(
    Object.entries(sie.branding).filter(([, v]) => typeof v === 'string' && v.trim())
  );
  if (!Object.keys(sie.branding).length) delete sie.branding;
}
const socialTargets = new Set(connectors.filter((c) => c.type === 'Social').map((c) => c.target));
const missingSocial = (sie.socialSignInConnectorTargets ?? []).filter((t) => !socialTargets.has(t));
sie.socialSignInConnectorTargets = (sie.socialSignInConnectorTargets ?? []).filter((t) => socialTargets.has(t));
if (missingSocial.length) log(`- social targets without a connector: ${missingSocial.join(', ')}`);
const hasEmailConnector = connectors.some((c) => c.type === 'Email');
if (sie.signUp?.identifiers?.includes('email') && !hasEmailConnector) {
  throw new Error(
    'Email sign-up requires an Email connector. Configure `email` in config/sso.config.json (the devFallback needs `npm run up` for the mailbox), then re-run.'
  );
}
await api('PATCH', '/api/sign-in-exp', sie);
log('= sign-in experience applied');
if (sie.branding) log(`= branding assets: ${Object.keys(sie.branding).join(', ')}`);
if (sie.customCss) log('= custom CSS applied');
if (sie.mfa) log(`= MFA: ${sie.mfa.factors.join(' + ')}, policy ${sie.mfa.policy}`);
if (sie.sentinelPolicy) log(`= lockout: ${sie.sentinelPolicy.maxAttempts} attempts, ${sie.sentinelPolicy.lockoutDuration} min`);

// --- Applications (+ client credentials for .env.apps) ---
step('Applications');
const applications = await api('GET', '/api/applications');
const envLines = ['# Generated by scripts/provision.js — do not edit or commit.'];
for (const wanted of config.applications) {
  if (!inProfile(wanted)) {
    log(`- ${wanted.name} (profile ${wanted.profiles.join('/')})`);
    continue;
  }
  const body = {
    oidcClientMetadata: { redirectUris: wanted.redirectUris, postLogoutRedirectUris: wanted.postLogoutRedirectUris },
    ...(wanted.customClientMetadata ? { customClientMetadata: wanted.customClientMetadata } : {}),
  };
  let app = applications.find((a) => a.name === wanted.name);
  if (app) {
    await api('PATCH', `/api/applications/${app.id}`, body);
    log(`= ${wanted.name} (${app.id})`);
  } else {
    app = await api('POST', '/api/applications', { name: wanted.name, type: wanted.type, ...body });
    log(`+ ${wanted.name} (${app.id})`);
  }
  // Token-endpoint auth uses the application_secrets store, not the legacy `secret` field.
  let secrets = await api('GET', `/api/applications/${app.id}/secrets`);
  if (!secrets.length) secrets = [await api('POST', `/api/applications/${app.id}/secrets`, { name: 'provisioned' })];
  const prefix = wanted.key.replace(/-/g, '_').toUpperCase();
  envLines.push(`${prefix}_CLIENT_ID=${app.id}`, `${prefix}_CLIENT_SECRET=${secrets[0].value}`);
}

// --- Role assignments (emails from env) ---
if (config.roleAssignments?.length) {
  step('Role assignments');
  for (const { role, emailsEnv } of config.roleAssignments) {
    const roleId = roleIds.get(role);
    if (!roleId) throw new Error(`roleAssignments: role "${role}" does not exist`);
    const emails = (process.env[emailsEnv] ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (!emails.length) {
      log(`- ${role} (env var not set: ${emailsEnv})`);
      continue;
    }
    for (const email of emails) {
      const matches = await api('GET', `/api/users?search=${encodeURIComponent(`%${email}%`)}`);
      const user = matches.find((u) => u.primaryEmail?.toLowerCase() === email);
      if (!user) {
        log(`- ${role} -> ${email} (no such user yet)`);
        continue;
      }
      if ((await api('GET', `/api/users/${user.id}/roles`)).some((r) => r.id === roleId)) log(`= ${role} -> ${email}`);
      else {
        await api('POST', `/api/users/${user.id}/roles`, { roleIds: [roleId] });
        log(`+ ${role} -> ${email}`);
      }
    }
  }
}

// --- Webhooks (+ signing keys for .env.apps) ---
if (config.hooks?.length) {
  step('Webhooks');
  const hooks = await api('GET', '/api/hooks');
  for (const wanted of config.hooks) {
    const body = { name: wanted.name, events: wanted.events, config: { url: wanted.url }, enabled: wanted.enabled ?? true };
    const note = `${body.events.join(', ')} -> ${wanted.url}${body.enabled ? '' : ' (disabled)'}`;
    let hook = hooks.find((h) => h.name === wanted.name);
    if (hook) {
      await api('PATCH', `/api/hooks/${hook.id}`, body);
      log(`= ${wanted.name}: ${note}`);
    } else {
      hook = await api('POST', '/api/hooks', body);
      log(`+ ${wanted.name}: ${note}`);
    }
    if (wanted.signingKeyEnvOut) envLines.push(`${wanted.signingKeyEnvOut}=${(await api('GET', `/api/hooks/${hook.id}`)).signingKey}`);
  }
}

// ENV_APPS_FILE: repo-relative output (the E2E stack uses .env.test.apps).
const appsFile = process.env.ENV_APPS_FILE ?? '.env.apps';
writeFileSync(new URL(`../${appsFile}`, import.meta.url), envLines.join('\n') + '\n');
step('Generated credentials');
log(`= wrote ${appsFile}`);

// --- Account center (profile self-service) ---
step('Account center');
await api('PATCH', '/api/account-center', config.accountCenter);
log(`= enabled=${config.accountCenter.enabled}, fields: ${Object.keys(config.accountCenter.fields).join(', ')}`);

// --- Custom profile fields (collected at sign-up, editable in account center) ---
step('Custom profile fields');
const profileFields = await api('GET', '/api/custom-profile-fields');
for (const wanted of config.customProfileFields ?? []) {
  if (profileFields.some((f) => f.name === wanted.name)) {
    log(`= ${wanted.name}`);
    continue;
  }
  await api('POST', '/api/custom-profile-fields', { ...wanted, required: wanted.required ?? false });
  log(`+ ${wanted.name}`);
}

// --- Custom JWT claims (access tokens) ---
const jwtClaims = config.customJwtClaims ?? {};
if (jwtClaims.fromCustomData?.length || jwtClaims.roles) {
  step('Custom JWT claims');
  await api('PUT', '/api/configs/jwt-customizer/access-token', { script: accessTokenScript(jwtClaims) });
  log(`= access-token claims: ${[...(jwtClaims.fromCustomData ?? []), ...(jwtClaims.roles ? ['roles'] : [])].join(', ')}`);
}

step(`Done. Issuer: ${endpoint()}/oidc`);
log(`Discovery:      ${endpoint()}/oidc/.well-known/openid-configuration`);
log(`Account center: ${endpoint()}/account`);
