// Config-as-code unit tests: sso.config.json against its schema, generated JWT-customizer script, TOTP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { accessTokenScript } from '../../scripts/lib/jwt-script.js';
import { totp } from '../../scripts/lib/totp.js';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const config = readJson('../../config/sso.config.json');
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(readJson('../../config/schemas/sso.config.schema.json'));

test('sso.config.json matches its schema', () => {
  assert.ok(validate(config), ajv.errorsText(validate.errors));
});

test('schema rejects wildcard redirect URIs (ID-09)', () => {
  const bad = structuredClone(config);
  bad.applications[0].redirectUris = ['http://localhost:3010/*'];
  assert.equal(validate(bad), false);
});

test('MFA policy is the global PromptAtSignInAndSignUp (ID-05)', () => {
  assert.deepEqual(config.signInExperience.mfa, { factors: ['Totp', 'BackupCode'], policy: 'PromptAtSignInAndSignUp' });
});

test('every role permission references a declared resource scope (ID-08)', () => {
  const declared = new Set(config.resources.flatMap((r) => (r.scopes ?? []).map((s) => `${r.indicator} ${s.name}`)));
  for (const role of config.roles) {
    for (const { resource, scopes } of role.permissions ?? []) {
      for (const scope of scopes) assert.ok(declared.has(`${resource} ${scope}`), `${role.name}: ${resource} ${scope}`);
    }
  }
});

test('generated JWT-customizer script emits customData claims and roles (ID-07)', async () => {
  const script = accessTokenScript(config.customJwtClaims);
  const getCustomJwtClaims = new Function(`${script}\nreturn getCustomJwtClaims;`)();
  const claims = await getCustomJwtClaims({
    token: {},
    context: { user: { customData: { displayName: 'Ada', other: 'x' }, roles: [{ name: 'user' }, { name: 'admin' }] } },
  });
  assert.deepEqual(claims, { displayName: 'Ada', roles: ['user', 'admin'] });
});

test('TOTP matches the RFC 6238 SHA-1 vector', () => {
  // Secret "12345678901234567890" at T=59s -> 94287082 (last 6 digits).
  assert.equal(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000), '287082');
});
