// Runs the shared contract suites (EX-06) over every Hub extension module: the v1 auth types, the
// EX-04 fixture auth type, and copies of the EX-07 templates; and every connector definition.
// Run: npm run test:contract
import { after } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_AUTH_TYPE_DIRS, DEFAULT_CONNECTOR_DIRS, dirsFromEnv, loadRegistry } from '../../apps/hub/core/registry.js';
import { startMockProvider } from '../mock-provider/app.js';
import { authTypeContract } from './auth-type.contract.js';
import { connectorContract } from './connector.contract.js';
import { contractFixtures } from './fixtures.js';

const repo = new URL('../../', import.meta.url);
const provider = await startMockProvider();

// Templates copied the way an author would (EX-07); the relative core import is re-pointed.
const templates = mkdtempSync(join(tmpdir(), 'hub-templates-'));
const coreExtension = new URL('apps/hub/core/extension.js', repo).href;
writeFileSync(
  join(templates, 'template-token.js'),
  readFileSync(new URL('apps/hub/auth-types/_template.js', repo), 'utf8').replace('../core/extension.js', coreExtension)
);
const templateConnectors = mkdtempSync(join(tmpdir(), 'hub-template-connectors-'));
copyFileSync(new URL('apps/hub/connectors/_template.json', repo), join(templateConnectors, 'template.json'));
after(async () => {
  await provider.close();
  for (const dir of [templates, templateConnectors]) rmSync(dir, { recursive: true, force: true });
});

const productionDir = dirsFromEnv(undefined, DEFAULT_CONNECTOR_DIRS)[0];
const registry = await loadRegistry({
  authTypeDirs: [...dirsFromEnv(undefined, DEFAULT_AUTH_TYPE_DIRS), ...dirsFromEnv('test/fixtures/auth-types', []), templates],
  connectorDirs: [productionDir, templateConnectors],
  env: new Proxy({}, { get: () => 'set' }),
});

const fixtures = contractFixtures(provider);
for (const handler of registry.authTypes.values()) authTypeContract(handler, fixtures[handler.type], provider);

const documentedEnv = new Set([...readFileSync(new URL('.env.example', repo), 'utf8').matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]));
for (const entry of registry.definitions.values()) {
  connectorContract(entry, { production: entry.file.startsWith(productionDir), documentedEnv });
}
