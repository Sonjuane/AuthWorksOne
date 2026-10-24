// Reconciles Hub data with Logto users (VA-08 backstop, build plan Q9): removes connections and
// consents of users that no longer exist in Logto, e.g. when a User.Deleted webhook was missed.
// Uses the provisioner's Management API credentials, so the Hub itself never holds Logto admin
// rights. Schedule it (cron) or run after Hub downtime.
// Usage: npm run hub:reconcile [-- --dry-run] [-- --force]
//   "+" = removed, "-" = would remove (dry run), "=" = nothing to do.
import { createAudit } from '../apps/hub/core/audit.js';
import { loadConfig } from '../apps/hub/core/config.js';
import { createConnections } from '../apps/hub/core/connections.js';
import { connect } from '../apps/hub/core/db.js';
import { createHttpClient } from '../apps/hub/core/http-client.js';
import { createLogger } from '../apps/hub/core/log.js';
import { DEFAULT_AUTH_TYPE_DIRS, DEFAULT_CONNECTOR_DIRS, dirsFromEnv, loadRegistry } from '../apps/hub/core/registry.js';
import { findOrphans, purgeUser } from '../apps/hub/core/users.js';
import { createVault } from '../apps/hub/core/vault.js';
import { api } from './lib/logto.js';

const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');
const config = loadConfig();
const log = createLogger({ base: { service: 'hub-reconcile' } });
const sql = connect(config.databaseUrl, { max: 2 });

try {
  const logtoUserIds = new Set();
  for (let page = 1; ; page++) {
    const batch = await api('GET', `/api/users?page=${page}&page_size=100`);
    batch.forEach((user) => logtoUserIds.add(user.id));
    if (batch.length < 100) break;
  }
  const { subs, orphans } = await findOrphans({ sql, tenantId: config.tenantId, logtoUserIds, force });
  console.log(`Hub reconcile (tenant ${config.tenantId}${dryRun ? ', dry run' : ''}): ${logtoUserIds.size} Logto users, ${subs} Hub users`);
  if (!orphans.length) console.log('  = no orphaned Hub users');

  const registry = await loadRegistry({
    authTypeDirs: dirsFromEnv(process.env.HUB_AUTH_TYPE_DIRS, DEFAULT_AUTH_TYPE_DIRS),
    connectorDirs: dirsFromEnv(process.env.HUB_CONNECTOR_DIRS, DEFAULT_CONNECTOR_DIRS),
    settings: config.connectorSettings,
  });
  const audit = createAudit({ sql, tenantId: config.tenantId, redact: log.redact });
  const vault = createVault({ keys: config.masterKeys, current: config.currentKeyVersion });
  const connections = createConnections({
    sql, vault, registry, tenantId: config.tenantId, http: createHttpClient({ allowPrivate: config.allowPrivateUrls }), baseUrl: config.baseUrl, audit, log,
  });
  for (const sub of orphans) {
    if (dryRun) {
      const [{ count }] = await sql`select count(*)::int as count from connections where tenant_id = ${config.tenantId} and sub = ${sub}`;
      console.log(`  - would remove ${sub}: ${count} connection(s)`);
      continue;
    }
    const result = await purgeUser({ sql, tenantId: config.tenantId, connections, audit, sub, source: 'reconcile' });
    console.log(`  + removed ${sub}: ${result.connections} connection(s)`);
  }
} catch (err) {
  console.error(`Hub reconcile failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
