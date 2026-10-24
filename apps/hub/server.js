// Connector Hub service entry point: validate config and secrets, require an up-to-date schema,
// then serve HTTP. Refuses to start (exit 1) when anything required is missing (NF-05).
import { startApp } from '../lib/web.js';
import { ApiError } from './core/auth.js';
import { ConfigError, loadConfig } from './core/config.js';
import { connect, pendingMigrations } from './core/db.js';
import { errorHandler, respond, respondError, securityHeaders } from './core/http.js';
import { createLogger } from './core/log.js';
import { migrationFiles } from './core/migrate.js';
import { createSessionStore } from './core/session-store.js';
import { createVault } from './core/vault.js';

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

const sql = connect(config.databaseUrl);
const pending = await pendingMigrations(sql, migrationFiles().map((m) => m.version)).catch((err) => fail(`database unavailable: ${err.message}`));
if (pending.length) fail(`pending migrations ${pending.join(', ')}; run npm run hub:migrate`);

const vault = createVault({ keys: config.masterKeys, current: config.currentKeyVersion });
const https = config.baseUrl.startsWith('https://');

startApp({
  name: 'Connector Hub',
  port: config.port,
  sessionStore: createSessionStore({ sql, vault, tenantId: config.tenantId }),
  headers: securityHeaders({ https }),
  secureCookies: https,
  notFound: (ctx) => respondError(ctx, new ApiError(404, 'not_found', 'No such route')),
  onError: errorHandler(log),
  onListen: () => log.info('started', { port: config.port, baseUrl: config.baseUrl, clients: [...config.clients.values()].map((c) => c.key) }),
  routes: {
    'GET /health': async (ctx) => {
      await sql`select 1`;
      return respond(ctx, { status: 'ok' });
    },
  },
});
