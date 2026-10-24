// E2E stack helpers (spec §7.2): URLs, compose commands, mock-provider control, test users, direct Hub
// API calls, and the run ledger the teardown scans read (secrets, Hub responses, expected audit events).
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { createClient } from '../../../scripts/lib/experience.js';
import { api } from '../../../scripts/lib/logto.js';

export const URLS = {
  logto: 'http://localhost:3001',
  rp: 'http://localhost:3010',
  second: 'http://localhost:3011',
  hub: 'http://localhost:3030',
  mock: 'http://localhost:3097',
  mailbox: 'http://localhost:3099',
};
// What the Hub and client apps (in compose) use to reach the mock provider.
export const MOCK_INTERNAL = 'http://mock-provider:3097';
export const repo = new URL('../../../', import.meta.url);
export const runtime = new URL('test/e2e/.runtime/', repo);
export const sso = JSON.parse(readFileSync(new URL('config/sso.config.json', repo)));
export const clientId = (key) => process.env[`${key.replace(/-/g, '_').toUpperCase()}_CLIENT_ID`];

const COMPOSE = ['compose', '-p', 'authworks-test', '-f', 'docker-compose.yml', '-f', 'docker-compose.test.yml', '--env-file', '.env.test', '--profile', 'test'];
export const compose = (...args) => execFileSync('docker', [...COMPOSE, ...args], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export const waitFor = async (url, tries = 90) => {
  for (let i = 0; i < tries; i++) {
    if (await fetch(url).then((r) => r.status < 500, () => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${url} did not become ready`);
};

// Mock provider control API (test/mock-provider/server.js): GET without a body, POST with one.
export const control = async (path, body) => (await fetch(`${URLS.mock}/_control/${path}`, {
  method: body === undefined && path === 'calls' ? 'GET' : 'POST',
  headers: { 'content-type': 'application/json' },
  body: path === 'calls' ? undefined : JSON.stringify(body ?? {}),
})).json();

// --- Run ledger (test/e2e/.runtime/ledger.jsonl) ---
const ledgerFile = new URL('ledger.jsonl', runtime);
export const record = (kind, value) => appendFileSync(ledgerFile, `${JSON.stringify({ kind, value })}\n`);
export const readLedger = () => (existsSync(ledgerFile) ? readFileSync(ledgerFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
// Expected Hub audit row (S16): { event, sub?, clientId?, errorCode? }.
export const expectAudit = (entry) => record('audit', entry);

// --- Test users: Management API, unique e2e-* email (teardown deletes every e2e-* user) ---
export const testEmail = (tag) => `e2e-${tag}-${Date.now()}-${randomBytes(2).toString('hex')}@example.com`;
export const newUser = async (tag, body = {}) => {
  const email = testEmail(tag);
  const password = `E2e!${randomBytes(6).toString('base64url')}9a`;
  const user = await api('POST', '/api/users', { primaryEmail: email, password, customData: { displayName: `E2E ${tag}` }, ...body });
  return { id: user.id, email, password };
};
export const assignRole = async (userId, name) => {
  const role = (await api('GET', `/api/roles?search=${encodeURIComponent(name)}`)).find((r) => r.name === name);
  await api('POST', `/api/users/${userId}/roles`, { roleIds: [role.id] });
};

// --- Direct Hub API calls with a real Logto token for a registered app (S5-S11, S14) ---
export const appToken = async (user, { key = 'sample-rp', resource = sso.hub.resource, scope = 'connections:read connections:token', id, secret } = {}) => {
  const app = sso.applications.find((a) => a.key === key);
  const prefix = key.replace(/-/g, '_').toUpperCase();
  const client = createClient({
    clientId: id ?? process.env[`${prefix}_CLIENT_ID`],
    clientSecret: secret ?? process.env[`${prefix}_CLIENT_SECRET`],
    redirectUri: app?.redirectUris[0] ?? 'http://localhost:3999/callback',
  });
  const { tokens, error } = await client.signIn(user.email, user.password, { scope: `openid offline_access ${scope}`, resource });
  if (!tokens) throw new Error(`sign-in failed: ${error}`);
  const token = (await client.token({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, resource })).data.access_token;
  record('secret', token);
  return token;
};
export const hubApi = async (method, path, token, body) => {
  const res = await fetch(`${URLS.hub}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body && JSON.stringify(body),
  });
  const json = await res.json();
  record('response', { path, body: json });
  if (json.data?.secret) for (const value of Object.values(json.data.secret)) record('secret', value);
  return { status: res.status, body: json };
};
