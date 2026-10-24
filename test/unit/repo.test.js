// Repository hygiene: dependencies stay on the approved list (NF-01) and every env var the code
// reads is documented in .env.example or generated into .env.apps (NF-04).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');

// Build plan §6. Add a package here only together with its justification in the plan.
const APPROVED = ['openid-client', 'jose', 'postgres', 'ajv', 'ajv-formats', 'vue', 'vite', '@vitejs/plugin-vue', 'tailwindcss', '@tailwindcss/vite', '@playwright/test'];

test('dependencies are on the approved list (NF-01)', () => {
  const pkg = JSON.parse(read('package.json'));
  const used = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
  assert.deepEqual(used.filter((name) => !APPROVED.includes(name)), []);
});

const jsFiles = (dir) =>
  readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(root, path)).isDirectory()) return name === 'node_modules' ? [] : jsFiles(path);
    return path.endsWith('.js') ? [path] : [];
  });

test('every env var read in code is documented (NF-04)', () => {
  const documented = new Set([...read('.env.example').matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]));
  const generated = (name) => /_CLIENT_(ID|SECRET)$/.test(name) || name === 'HUB_WEBHOOK_SIGNING_KEY';
  const runtime = new Set(['NODE_ENV', 'PATH']);
  const used = new Set();
  for (const file of ['apps', 'scripts', 'test'].flatMap(jsFiles)) {
    for (const m of read(file).matchAll(/\benv\.([A-Z][A-Z0-9_]+)|need\('([A-Z0-9_]+)'\)|'(HUB_[A-Z0-9_]+|LOGTO_[A-Z0-9_]+)',/g)) used.add(m[1] ?? m[2] ?? m[3]);
  }
  const config = JSON.parse(read('config/sso.config.json'));
  for (const m of JSON.stringify(config).matchAll(/"(?:emailsEnv)":"([A-Z0-9_]+)"|"[a-zA-Z]+":"([A-Z][A-Z0-9_]{3,})"/g)) {
    const name = m[1] ?? m[2];
    if (/_(ID|SECRET|KEY|URL|TOKEN|REGION|FROM|EMAILS)$/.test(name) && !name.startsWith('HUB_WEBHOOK')) used.add(name);
  }
  const undocumented = [...used].filter((name) => !documented.has(name) && !generated(name) && !runtime.has(name));
  assert.deepEqual(undocumented.sort(), []);
});
