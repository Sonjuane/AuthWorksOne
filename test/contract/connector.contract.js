// Shared contract suite for connector definitions (EX-06). Runs for every definition the registry
// loads (the registry already enforced the JSON Schema, a bound handler, valid `settings`, and
// required credential fields — CN-01, CN-05).
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Template variables each issued secret field makes available (core/extension.js templateVars).
const VARS_FOR_SECRET = { accessToken: ['accessToken'], apiKey: ['apiKey'], username: ['username', 'basic'], appPassword: ['basic'] };
const placeholders = (text) => [...String(text).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
const urls = (value) =>
  typeof value === 'string' ? (/^[a-z]+:\/\//i.test(value) ? [value] : []) : value && typeof value === 'object' ? Object.values(value).flatMap(urls) : [];

export function connectorContract({ definition, handler, file }, { production, documentedEnv }) {
  const name = `connector ${definition.id} (${file.split('/').slice(-2).join('/')})`;
  const allowed = new Set(handler.secretFields.flatMap((field) => VARS_FOR_SECRET[field] ?? []));

  test(`${name}: test request and auth format only use variables its auth type issues`, () => {
    const used = [...Object.values(definition.test.headers ?? {}), definition.test.path, definition.auth?.format ?? ''].flatMap(placeholders);
    assert.deepEqual(used.filter((v) => !allowed.has(v)), []);
    assert.ok(used.length > 0, 'the test request must send the credential');
  });

  test(`${name}: declares how apps send the credential (TV-05 auth hint)`, () => {
    assert.ok(definition.auth?.header && placeholders(definition.auth.format).length, 'auth.header + auth.format with a placeholder');
  });

  test(`${name}: secrets come from env names only (CN-02)`, () => {
    for (const [key, envName] of Object.entries(definition.env ?? {})) {
      assert.match(envName, /^[A-Z][A-Z0-9_]*$/, `${key} must name an env var`);
      if (production) assert.ok(documentedEnv.has(envName), `${envName} must be documented in .env.example`);
    }
    if (handler.type === 'oauth2') assert.deepEqual(Object.keys(definition.env ?? {}).sort(), ['clientId', 'clientSecret']);
  });

  if (production) {
    test(`${name}: production endpoints use https`, () => {
      assert.deepEqual(urls({ settings: definition.settings, baseUrl: definition.baseUrl }).filter((u) => !u.startsWith('https://')), []);
    });
  }
}
