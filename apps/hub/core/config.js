// Hub configuration: env (secrets; NF-05) + config/sso.config.json (Hub resource, per-client
// settings keyed by app `key` and resolved to Logto client IDs from .env.apps; HA-05).
import { readFileSync } from 'node:fs';
import { parseMasterKeys } from './vault.js';

const REQUIRED_ENV = [
  'LOGTO_ENDPOINT',
  'HUB_BASE_URL',
  'HUB_DATABASE_URL',
  'HUB_MASTER_KEYS',
  'HUB_MASTER_KEY_CURRENT',
  'HUB_UI_CLIENT_ID',
  'HUB_UI_CLIENT_SECRET',
  'HUB_WEBHOOK_SIGNING_KEY',
];

export class ConfigError extends Error {}

const ssoConfigUrl = new URL('../../../config/sso.config.json', import.meta.url);

export function loadConfig({ env = process.env, sso = JSON.parse(readFileSync(ssoConfigUrl)) } = {}) {
  const missing = REQUIRED_ENV.filter((name) => !env[name]);
  if (missing.length) throw new ConfigError(`Missing required env vars: ${missing.join(', ')} (see .env.example)`);

  const production = env.NODE_ENV === 'production';
  const baseUrl = env.HUB_BASE_URL.replace(/\/$/, '');
  if (production && !baseUrl.startsWith('https://')) throw new ConfigError('HUB_BASE_URL must be https:// in production (NF-06)');

  const allowPrivateUrls = env.HUB_ALLOW_PRIVATE_URLS === '1';
  if (production && allowPrivateUrls) throw new ConfigError('HUB_ALLOW_PRIVATE_URLS=1 is not allowed in production (SSRF guard)');

  let masterKeys;
  try {
    masterKeys = parseMasterKeys(env.HUB_MASTER_KEYS);
  } catch (err) {
    throw new ConfigError(err.message);
  }
  if (!masterKeys.has(env.HUB_MASTER_KEY_CURRENT)) throw new ConfigError(`HUB_MASTER_KEY_CURRENT "${env.HUB_MASTER_KEY_CURRENT}" is not in HUB_MASTER_KEYS`);

  // Per-client settings: config `key` -> <KEY>_CLIENT_ID. Clients without a provisioned ID are skipped.
  const clients = new Map();
  const skippedClients = [];
  for (const app of sso.applications.filter((a) => a.hub)) {
    const clientId = env[`${app.key.replace(/-/g, '_').toUpperCase()}_CLIENT_ID`];
    if (!clientId) {
      skippedClients.push(app.key);
      continue;
    }
    clients.set(clientId, { key: app.key, name: app.name, ...app.hub });
  }

  const ui = sso.applications.find((a) => a.key === 'hub-ui');
  const logto = env.LOGTO_ENDPOINT.replace(/\/$/, '');
  const logtoInternal = (env.LOGTO_INTERNAL_ENDPOINT ?? logto).replace(/\/$/, '');
  return {
    production,
    // v1 is single-tenant (NF-03); HUB_TENANT_ID only isolates test runs.
    tenantId: env.HUB_TENANT_ID ?? 'default',
    port: Number(env.HUB_PORT ?? ui?.port ?? 3030),
    baseUrl,
    issuer: `${logto}/oidc`,
    jwksUri: `${logtoInternal}/oidc/jwks`,
    logtoInternalOrigin: logtoInternal !== logto ? new URL(logtoInternal).origin : undefined,
    allowPrivateUrls,
    resource: sso.hub.resource,
    databaseUrl: env.HUB_DATABASE_URL,
    masterKeys,
    currentKeyVersion: env.HUB_MASTER_KEY_CURRENT,
    ui: { clientId: env.HUB_UI_CLIENT_ID, clientSecret: env.HUB_UI_CLIENT_SECRET, scope: ui?.scope },
    webhookSigningKey: env.HUB_WEBHOOK_SIGNING_KEY,
    clients,
    skippedClients,
    connectorSettings: sso.hub.connectors ?? {},
  };
}
