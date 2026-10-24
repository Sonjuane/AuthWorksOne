// Hub extension points: registry loading/validation (CN-01, CN-02, CN-05, EX-02, EX-05), core
// isolation from provider code (EX-02), and the schema-first API document + manifest (TV-07).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { buildManifest, loadOpenApi } from '../../apps/hub/core/manifest.js';
import { DEFAULT_AUTH_TYPE_DIRS, DEFAULT_CONNECTOR_DIRS, dirsFromEnv, loadRegistry, RegistryError } from '../../apps/hub/core/registry.js';

const authTypeDirs = dirsFromEnv(undefined, DEFAULT_AUTH_TYPE_DIRS);
const connectorDirs = dirsFromEnv(undefined, DEFAULT_CONNECTOR_DIRS);
const temps = [];
after(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const tempDir = (files) => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-registry-'));
  temps.push(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  return dir;
};
const allEnv = new Proxy({}, { get: () => 'set' });
const hubspot = JSON.parse(readFileSync(join(connectorDirs[0], 'hubspot.json'), 'utf8'));

test('registry loads the v1 auth types and connectors; templates and docs modules are ignored', async () => {
  const registry = await loadRegistry({ authTypeDirs, connectorDirs, env: allEnv });
  assert.deepEqual([...registry.authTypes.keys()].sort(), ['api_key', 'app_password', 'oauth2']);
  assert.deepEqual([...registry.connectors.keys()].sort(), ['clickup', 'google', 'hubspot', 'wordpress']);
  assert.deepEqual(registry.connectors.get('hubspot').client, { clientId: 'set', clientSecret: 'set' });
});

test('connectors with missing env are skipped and reported, not fatal (CN-02)', async () => {
  const logged = [];
  const registry = await loadRegistry({ authTypeDirs, connectorDirs, env: {}, log: (event, fields) => logged.push({ event, ...fields }) });
  assert.deepEqual([...registry.connectors.keys()], ['wordpress']);
  assert.deepEqual(logged.find((l) => l.id === 'hubspot'), { event: 'connector_skipped', id: 'hubspot', missingEnv: ['HUBSPOT_CLIENT_ID', 'HUBSPOT_CLIENT_SECRET'] });
});

test('connectors disabled in config are absent (EX-05)', async () => {
  const registry = await loadRegistry({ authTypeDirs, connectorDirs, env: allEnv, settings: { google: { enabled: false } } });
  assert.equal(registry.connectors.has('google'), false);
  assert.deepEqual(registry.skipped, [{ id: 'google', reason: 'disabled' }]);
});

test('a later connector directory overrides a definition by id', async () => {
  const override = tempDir({ 'hubspot.json': { ...hubspot, name: 'HubSpot (mock)', baseUrl: { fixed: 'http://localhost:3097' } } });
  const registry = await loadRegistry({ authTypeDirs, connectorDirs: [...connectorDirs, override], env: allEnv });
  assert.equal(registry.connectors.get('hubspot').definition.name, 'HubSpot (mock)');
});

test('invalid definitions fail loading with every problem listed (CN-05)', async () => {
  const bad = tempDir({
    'broken.json': '{ not json',
    'schema.json': { id: 'Bad Id', name: 'x', authType: 'oauth2' },
    'unknown.json': { ...hubspot, id: 'unknown', authType: 'oauth1' },
    'settings.json': { ...hubspot, id: 'settings', settings: { tokenUrl: 'https://x' } },
    'fields.json': { id: 'fields', name: 'x', authType: 'app_password', baseUrl: { fromField: 'siteUrl' }, test: { method: 'GET', path: '/me' } },
  });
  await assert.rejects(loadRegistry({ authTypeDirs, connectorDirs: [bad], env: allEnv }), (err) => {
    assert.ok(err instanceof RegistryError);
    assert.equal(err.problems.length, 5, err.message);
    for (const [file, reason] of [['broken', /invalid JSON/], ['schema', /pattern|required/], ['unknown', /unknown authType "oauth1"/], ['settings', /authorizeUrl/], ['fields', /must include username, appPassword, siteUrl/]]) {
      assert.match(err.problems.find((p) => p.includes(`${file}.json`)), reason);
    }
    return true;
  });
});

test('invalid auth type modules fail loading (EX-03)', async () => {
  const bad = tempDir({ 'half.js': "export default { type: 'half', definitionSchema: {}, requiredCredentialFields: [], secretFields: ['apiKey'], getCredentials() {} };" });
  await assert.rejects(loadRegistry({ authTypeDirs: [...authTypeDirs, bad], connectorDirs, env: allEnv }), /test is required.*exactly one of/);
});

test('Hub core never imports provider-specific modules (EX-02)', () => {
  const coreDir = new URL('../../apps/hub/core/', import.meta.url);
  for (const file of readdirSync(coreDir)) {
    const imports = [...readFileSync(new URL(file, coreDir), 'utf8').matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(imports.filter((path) => /auth-types|connectors/.test(path)), [], file);
  }
});

// --- OpenAPI (TV-07) + manifest ---
const doc = loadOpenApi();
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ $id: 'openapi', components: doc.components });
const schema = (name) => ajv.getSchema(`openapi#/components/schemas/${name}`);

test('every operation is documented, secured, and its schemas compile (TV-07)', () => {
  for (const [path, operations] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(operations)) {
      const where = `${method.toUpperCase()} ${path}`;
      assert.match(op.operationId, /^[a-z_]+$/, where);
      assert.ok(op.description?.length > 40, `${where}: description for AI tool selection`);
      assert.ok(Array.isArray(op.security), `${where}: explicit security`);
    }
  }
  for (const name of Object.keys(doc.components.schemas)) assert.ok(schema(name), name);
});

test('the Credential schema cannot carry a refresh token (TV-05)', () => {
  const valid = schema('Credential');
  const credential = { connectionId: '7c9e6679-7425-40de-944b-e07fc1f90ae7', connectorId: 'hubspot', authType: 'oauth2', secret: { accessToken: 'a' }, expiresAt: null, baseUrl: 'https://api.hubapi.com' };
  assert.ok(valid(credential), JSON.stringify(valid.errors));
  assert.equal(valid({ ...credential, secret: { accessToken: 'a', refreshToken: 'r' } }), false);
  assert.equal(valid({ ...credential, refreshToken: 'r' }), false);
});

test('error envelope covers every TV-06 code', () => {
  const codes = doc.components.schemas.Error.properties.code.enum;
  for (const code of ['consent_required', 'connection_reauth_required', 'connection_not_found', 'connector_not_allowed_for_client', 'client_not_registered']) assert.ok(codes.includes(code), code);
  assert.ok(schema('ErrorResponse')({ meta: { requestId: 'req_1', apiVersion: '1' }, error: { code: 'consent_required', message: 'm', consentUrl: 'https://hub/consent' } }));
});

test('manifest lists API operations with inlined input schemas', () => {
  const { tools } = buildManifest(doc);
  assert.deepEqual(tools.map((t) => t.name), ['list_connections', 'get_credentials']);
  const credentials = tools.find((t) => t.name === 'get_credentials');
  assert.equal(JSON.stringify(credentials.inputSchema).includes('$ref'), false);
  assert.equal(credentials.inputSchema.oneOf.length, 2);
  assert.deepEqual(credentials.http, { method: 'POST', path: '/v1/credentials', scopes: ['connections:token'] });
  assert.ok(schema('Manifest')({ meta: { requestId: 'req_1', apiVersion: '1' }, data: { tools } }));
});
