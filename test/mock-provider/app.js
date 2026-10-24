// Mock third-party provider for Hub tests (spec §7.1): OAuth 2.0 authorization server (PKCE,
// refresh, revoke), bearer/API-key/Basic-auth resource APIs (incl. WordPress shape), and
// controls to expire tokens or fail refreshes. Tokens are prefixed mock_at_ / mock_rt_ so log
// and DB scans can find them. startMockProvider() runs it in-process on an ephemeral port.
// Also a login IdP under /oidc for Logto's generic OIDC connectors (mock-google / mock-github).
// node:crypto only: the compose service runs without node_modules.
import { createServer } from 'node:http';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

const CLIENT = { id: 'mock-client', secret: 'mock-secret' };
// Record lists at real provider paths (HubSpot, ClickUp, Google Drive), so the reference client
// app makes the same calls against the mock as against the real providers.
const RECORDS = {
  'GET /crm/v3/objects/contacts': { results: [{ id: '101', properties: { email: 'contact@example.com' } }] },
  'GET /team': { teams: [{ id: '9001', name: 'Mock workspace' }] },
  'GET /drive/v3/files': { files: [{ id: 'file-1', name: 'Mock document' }] },
};
const rand = (prefix) => `${prefix}${randomBytes(12).toString('hex')}`;

// Login IdP: an HTML form picks the email and whether it is verified (S2, S18). ES256 ID tokens;
// `sub` is stable per (client_id, email), so each mock provider is a distinct identity.
const idKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = { ...idKeys.publicKey.export({ format: 'jwk' }), kid: 'mock', alg: 'ES256', use: 'sig' };
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const signIdToken = (claims) => {
  const input = `${b64({ alg: 'ES256', kid: 'mock', typ: 'JWT' })}.${b64(claims)}`;
  return `${input}.${sign('sha256', Buffer.from(input), { key: idKeys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
};
const attr = (value) => String(value ?? '').replace(/[&"<>]/g, (c) => `&#${c.charCodeAt(0)};`);
const loginForm = (params) => `<!doctype html><html><head><meta charset="utf-8"><title>Mock sign-in (${attr(params.get('client_id'))})</title></head>
<body><h1>Mock sign-in: ${attr(params.get('client_id'))}</h1><form method="post">
${['redirect_uri', 'state', 'nonce', 'client_id'].map((k) => `<input type="hidden" name="${k}" value="${attr(params.get(k))}">`).join('')}
<label>Email <input name="email" type="email" required></label>
<label><input name="verified" type="checkbox" checked> Email verified</label>
<button type="submit">Sign in</button></form></body></html>`;

export function createMockProvider() {
  let state;
  const reset = () => {
    state = { codes: new Map(), idCodes: new Map(), access: new Map(), refresh: new Map(), appPasswords: new Map(), apiKeys: new Set(), failRefresh: false, expiresIn: 3600, refreshDelayMs: 0, calls: {} };
  };
  reset();

  const issue = (refreshToken = rand('mock_rt_')) => {
    const accessToken = rand('mock_at_');
    state.access.set(accessToken, { refreshToken, expiresAt: Date.now() + state.expiresIn * 1000, revoked: false });
    if (!state.refresh.has(refreshToken)) state.refresh.set(refreshToken, { revoked: false });
    return { access_token: accessToken, refresh_token: refreshToken, expires_in: state.expiresIn, token_type: 'bearer' };
  };
  const revoke = (token) => {
    if (state.access.has(token)) state.access.get(token).revoked = true;
    if (state.refresh.has(token)) {
      state.refresh.get(token).revoked = true;
      for (const entry of state.access.values()) if (entry.refreshToken === token) entry.revoked = true;
    }
  };
  const bearerValid = (header) => {
    const entry = state.access.get(/^Bearer (.+)$/i.exec(header ?? '')?.[1] ?? header ?? '');
    return entry && !entry.revoked && entry.expiresAt > Date.now();
  };
  const basicUser = (header) => {
    const [user, pass] = Buffer.from(/^Basic (.+)$/i.exec(header ?? '')?.[1] ?? '', 'base64').toString().split(':');
    return user && state.appPasswords.get(user) === pass ? user : null;
  };

  const control = {
    reset,
    expireAccessTokens: () => { for (const entry of state.access.values()) entry.expiresAt = Date.now() - 1000; },
    setFailRefresh: (value) => { state.failRefresh = value; },
    setExpiresIn: (seconds) => { state.expiresIn = seconds; },
    // Slow refresh responses so concurrent requests really overlap (refresh-lock tests).
    setRefreshDelay: (ms) => { state.refreshDelayMs = ms; },
    addAppPassword: (user, password) => state.appPasswords.set(user, password.replace(/\s+/g, '')),
    addApiKey: (key) => state.apiKeys.add(key),
    // A valid bearer token without an OAuth flow (for user-entered-token auth types).
    issueAccessToken: () => issue().access_token,
    calls: () => ({ ...state.calls }),
    client: CLIENT,
  };

  const handle = async (req, res) => {
    const url = new URL(req.url, 'http://mock');
    const route = `${req.method} ${url.pathname.replace(/\/oauth\/refresh-tokens\/.+$/, '/oauth/refresh-tokens/:token')}`;
    state.calls[route] = (state.calls[route] ?? 0) + 1;
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const form = new URLSearchParams(raw);
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };

    switch (route) {
      case 'GET /oidc/authorize':
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(loginForm(url.searchParams));
      case 'POST /oidc/authorize': {
        const code = rand('mock_idc_');
        state.idCodes.set(code, { email: form.get('email'), verified: form.has('verified'), nonce: form.get('nonce'), aud: form.get('client_id') });
        const to = new URL(form.get('redirect_uri'));
        to.searchParams.set('code', code);
        to.searchParams.set('state', form.get('state'));
        return send(302, undefined, { location: to.href });
      }
      case 'POST /oidc/token': {
        const grant = state.idCodes.get(form.get('code'));
        state.idCodes.delete(form.get('code'));
        if (!grant) return send(400, { error: 'invalid_grant' });
        const now = Math.floor(Date.now() / 1000);
        const sub = createHash('sha256').update(`${grant.aud}:${grant.email}`).digest('hex').slice(0, 24);
        const idToken = signIdToken({
          iss: `http://${req.headers.host}/oidc`, aud: grant.aud, sub, email: grant.email, email_verified: grant.verified,
          ...(grant.nonce ? { nonce: grant.nonce } : {}), iat: now, exp: now + 300,
        });
        return send(200, { access_token: rand('mock_idat_'), token_type: 'Bearer', expires_in: 300, id_token: idToken });
      }
      case 'GET /oidc/jwks':
        return send(200, { keys: [jwk] });
      case 'GET /oauth/authorize': {
        const to = new URL(url.searchParams.get('redirect_uri'));
        const code = rand('mock_code_');
        state.codes.set(code, { redirectUri: to.href, challenge: url.searchParams.get('code_challenge') });
        to.searchParams.set('code', code);
        to.searchParams.set('state', url.searchParams.get('state'));
        return send(302, undefined, { location: to.href });
      }
      case 'POST /oauth/token': {
        // Client credentials accepted via Basic auth, form body, or query string.
        const basic = Buffer.from(/^Basic (.+)$/i.exec(req.headers.authorization ?? '')?.[1] ?? '', 'base64').toString().split(':').map(decodeURIComponent);
        const id = basic[0] || form.get('client_id') || url.searchParams.get('client_id');
        const secret = basic[1] || form.get('client_secret') || url.searchParams.get('client_secret');
        if (id !== CLIENT.id || secret !== CLIENT.secret) return send(401, { error: 'invalid_client' });
        if (form.get('grant_type') === 'authorization_code') {
          const grant = state.codes.get(form.get('code'));
          state.codes.delete(form.get('code'));
          if (!grant || grant.redirectUri !== form.get('redirect_uri')) return send(400, { error: 'invalid_grant' });
          if (grant.challenge && createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') !== grant.challenge) {
            return send(400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
          }
          return send(200, issue());
        }
        if (form.get('grant_type') === 'refresh_token') {
          if (state.refreshDelayMs) await new Promise((resolve) => setTimeout(resolve, state.refreshDelayMs));
          const entry = state.refresh.get(form.get('refresh_token'));
          if (state.failRefresh || !entry || entry.revoked) return send(400, { error: 'invalid_grant' });
          const { refresh_token: _kept, ...tokens } = issue(form.get('refresh_token'));
          return send(200, tokens);
        }
        return send(400, { error: 'unsupported_grant_type' });
      }
      case 'POST /oauth/revoke':
        revoke(form.get('token') ?? url.searchParams.get('token'));
        return send(200, {});
      case 'DELETE /oauth/refresh-tokens/:token':
        revoke(decodeURIComponent(url.pathname.split('/').pop()));
        return send(204);
      case 'GET /api/me':
        return bearerValid(req.headers.authorization) ? send(200, { id: 'mock-user-1', name: 'Mock User' }) : send(401, { error: 'invalid_token' });
      case 'GET /api/records':
        return bearerValid(req.headers.authorization) ? send(200, { results: [{ id: 'rec-1', name: 'First record' }] }) : send(401, { error: 'invalid_token' });
      case 'GET /api/key/me':
        return state.apiKeys.has(req.headers['x-api-key']) ? send(200, { id: 'key-account', name: 'API key account' }) : send(401, { error: 'invalid_key' });
      case 'GET /wp-json/wp/v2/users/me': {
        const user = basicUser(req.headers.authorization);
        return user ? send(200, { id: 1, name: user }) : send(401, { code: 'rest_not_logged_in' });
      }
      case 'GET /wp-json/wp/v2/posts':
        return basicUser(req.headers.authorization) ? send(200, [{ id: 1, title: { rendered: 'Hello world' } }]) : send(401, { code: 'rest_not_logged_in' });
      default:
        if (RECORDS[route]) return bearerValid(req.headers.authorization) ? send(200, RECORDS[route]) : send(401, { error: 'invalid_token' });
        return send(404, { error: 'not_found' });
    }
  };

  return { handle, control };
}

export async function startMockProvider({ port = 0, host = '127.0.0.1' } = {}) {
  const { handle, control } = createMockProvider();
  const server = createServer((req, res) => handle(req, res).catch((err) => { res.writeHead(500); res.end(err.message); }));
  await new Promise((resolve) => server.listen(port, host, resolve));
  return {
    url: `http://${host}:${server.address().port}`,
    control,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }),
  };
}
