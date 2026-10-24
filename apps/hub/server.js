// Connector Hub service entry point: validate config and secrets, require an up-to-date schema,
// then serve HTTP. Refuses to start (exit 1) when anything required is missing (NF-05).
import { createVerifier } from '../lib/jwt.js';
import { createOidc } from '../lib/oidc.js';
import { startApp } from '../lib/web.js';
import { createAudit } from './core/audit.js';
import { ApiError, createAuthenticator } from './core/auth.js';
import { ConfigError, loadConfig } from './core/config.js';
import { createConnections } from './core/connections.js';
import { createConsents } from './core/consent.js';
import { connect, pendingMigrations } from './core/db.js';
import { createHttpClient } from './core/http-client.js';
import { errorHandler, respond, respondError, securityHeaders } from './core/http.js';
import { createLogger } from './core/log.js';
import { buildManifest, loadOpenApi } from './core/manifest.js';
import { migrationFiles } from './core/migrate.js';
import { DEFAULT_AUTH_TYPE_DIRS, DEFAULT_CONNECTOR_DIRS, dirsFromEnv, loadRegistry, RegistryError } from './core/registry.js';
import { openApiValidator } from './core/schema.js';
import { createSessionStore } from './core/session-store.js';
import { purgeUser } from './core/users.js';
import { createVault } from './core/vault.js';
import { apiRoutes } from './routes/api.js';
import { authRoutes } from './routes/auth.js';
import { connectRoutes } from './routes/connect.js';
import { uiApiRoutes } from './routes/ui-api.js';
import { webhookRoutes } from './routes/webhooks.js';

const log = createLogger({ base: { service: 'hub' } });
const fail = (reason) => {
  log.error('startup_failed', { reason });
  process.exit(1);
};

let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) fail(err.message);
  throw err;
}
for (const value of [config.ui.clientSecret, config.webhookSigningKey, config.databaseUrl, ...[...config.masterKeys.values()].map((k) => k.toString('base64'))]) {
  log.registerSecret(value);
}
for (const key of config.skippedClients) log.warn('client_skipped', { key, reason: 'no client ID in .env.apps (not provisioned in this profile)' });

let registry;
try {
  registry = await loadRegistry({
    authTypeDirs: dirsFromEnv(process.env.HUB_AUTH_TYPE_DIRS, DEFAULT_AUTH_TYPE_DIRS),
    connectorDirs: dirsFromEnv(process.env.HUB_CONNECTOR_DIRS, DEFAULT_CONNECTOR_DIRS),
    settings: config.connectorSettings,
    log: (event, fields) => log.warn(event, fields),
  });
} catch (err) {
  if (err instanceof RegistryError) fail(err.message);
  throw err;
}
for (const entry of registry.connectors.values()) Object.values(entry.client).forEach(log.registerSecret);
const openApi = loadOpenApi();
const manifest = buildManifest(openApi);

const sql = connect(config.databaseUrl);
const pending = await pendingMigrations(sql, migrationFiles().map((m) => m.version)).catch((err) => fail(`database unavailable: ${err.message}`));
if (pending.length) fail(`pending migrations ${pending.join(', ')}; run npm run hub:migrate`);

const vault = createVault({ keys: config.masterKeys, current: config.currentKeyVersion });
const https = config.baseUrl.startsWith('https://');

// Expired sessions and abandoned connector OAuth flows: purged at startup and hourly (safe on every instance).
const purgeExpired = () =>
  sql`with s as (delete from sessions where expires_at < now() returning 1), o as (delete from oauth_states where expires_at < now() returning 1)
      select (select count(*) from s)::int as sessions, (select count(*) from o)::int as states`
    .then(([counts]) => (counts.sessions || counts.states) && log.info('expired_purged', counts))
    .catch((err) => log.warn('purge_failed', { error: err }));
await purgeExpired();
setInterval(purgeExpired, 3600_000).unref();
if (config.allowPrivateUrls) log.warn('ssrf_guard_relaxed', { reason: 'HUB_ALLOW_PRIVATE_URLS=1 (dev/test only)' });

const oidc = await createOidc({
  issuer: config.issuer,
  clientId: config.ui.clientId,
  clientSecret: config.ui.clientSecret,
  baseUrl: config.baseUrl,
  scope: config.ui.scope,
  resource: config.resource,
  internalOrigin: config.logtoInternalOrigin,
}).catch((err) => fail(`Logto discovery failed: ${err.message}`));

const audit = createAudit({ sql, tenantId: config.tenantId, redact: log.redact });
const connections = createConnections({
  sql,
  vault,
  registry,
  tenantId: config.tenantId,
  http: createHttpClient({ allowPrivate: config.allowPrivateUrls }),
  baseUrl: config.baseUrl,
  audit,
  log,
});
const consents = createConsents({ sql, tenantId: config.tenantId, clients: config.clients, registry, baseUrl: config.baseUrl, audit });
const authenticate = createAuthenticator({
  verify: createVerifier({ issuer: config.issuer, audience: config.resource, jwksUri: config.jwksUri }),
  clients: config.clients,
});
const onUserDeleted = ({ sub, context }) => purgeUser({ sql, tenantId: config.tenantId, connections, audit, sub, source: 'webhook', context });

startApp({
  name: 'Connector Hub',
  port: config.port,
  sessionStore: createSessionStore({ sql, vault, tenantId: config.tenantId }),
  headers: securityHeaders({ https }),
  secureCookies: https,
  notFound: (ctx) => respondError(ctx, new ApiError(404, 'not_found', 'No such route')),
  onError: errorHandler(log),
  onListen: () =>
    log.info('started', {
      port: config.port,
      baseUrl: config.baseUrl,
      clients: [...config.clients.values()].map((c) => c.key),
      authTypes: [...registry.authTypes.keys()],
      connectors: [...registry.connectors.keys()],
    }),
  routes: {
    'GET /health': async (ctx) => {
      await sql`select 1`;
      return respond(ctx, { status: 'ok' });
    },
    'GET /openapi.json': (ctx) => ctx.json(openApi),
    'GET /v1/manifest': (ctx) => respond(ctx, manifest),
    ...apiRoutes({ authenticate, connections, consents, audit, validate: openApiValidator(openApi) }),
    ...authRoutes({ oidc, baseUrl: config.baseUrl }),
    ...connectRoutes({ connections }),
    ...uiApiRoutes({ connections, consents }),
    ...webhookRoutes({ signingKey: config.webhookSigningKey, onUserDeleted, log }),
  },
});
