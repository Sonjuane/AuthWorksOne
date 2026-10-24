// Reference client app (Deliverable 3): a third-party app needs only the issuer URL + client
// ID/secret for PKCE login, JWKS-verified tokens, userinfo, and SSO logout. With a `hub` block in
// config it also uses the Connector Hub API: consented connections, credentials (following
// consentUrl / reconnectUrl), and one record fetched per connector with the returned token.
// APP_KEY picks the config entry (default `sample-rp`; `second-client` for scenario S6).
import { readFileSync } from 'node:fs';
import { startApp, page, escapeHtml } from '../lib/web.js';
import { createOidc } from '../lib/oidc.js';

const config = JSON.parse(readFileSync(new URL('../../config/sso.config.json', import.meta.url)));
const appKey = process.env.APP_KEY ?? 'sample-rp';
const app = config.applications.find((a) => a.key === appKey);
const envPrefix = appKey.replace(/-/g, '_').toUpperCase();
const logtoEndpoint = process.env.LOGTO_ENDPOINT.replace(/\/$/, '');
// Browser links use the Hub's public URL; API calls may use an internal one (HUB_URL in compose).
const hubPublicUrl = config.applications.find((a) => a.key === 'hub-ui').baseUrl;
const hubUrl = (process.env.HUB_URL ?? hubPublicUrl).replace(/\/$/, '');
const hubResource = app.hub ? config.hub.resource : undefined;

const oidc = await createOidc({
  issuer: `${logtoEndpoint}/oidc`,
  clientId: process.env[`${envPrefix}_CLIENT_ID`],
  clientSecret: process.env[`${envPrefix}_CLIENT_SECRET`],
  baseUrl: app.baseUrl,
  scope: app.scope,
  resource: [...new Set([app.resource, hubResource].filter(Boolean))],
  internalOrigin: process.env.LOGTO_INTERNAL_ENDPOINT,
});

// One record per connector, at the real provider path (the test mock provider serves the same paths;
// the live smoke tests reuse them).
const RECORD_PATHS = JSON.parse(readFileSync(new URL('./record-paths.json', import.meta.url)));

const json = (value) => `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
const back = (to = '/', label = 'Back') => `<a class="button" href="${to}">${label}</a>`;

// Hub resource JWT, reused until a minute before expiry.
const hubToken = async (session) => {
  if (session.hubToken && session.hubToken.exp * 1000 - Date.now() > 60_000) return session.hubToken.value;
  const { accessToken, payload } = await oidc.resourceToken(session, hubResource);
  session.hubToken = { value: accessToken, exp: payload.exp };
  return accessToken;
};

// Hub API call; returns the `{ meta, data | error }` envelope.
const hub = async (session, method, path, body) => {
  const res = await fetch(`${hubUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${await hubToken(session)}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body && JSON.stringify(body),
  });
  return res.json();
};

// Provider auth header from the credential's `auth` hint ({{accessToken}}, {{apiKey}}, {{basic}}).
const authHeader = ({ secret, auth = { header: 'Authorization', format: 'Bearer {{accessToken}}' } }) => {
  const values = { ...secret, basic: secret.username && Buffer.from(`${secret.username}:${secret.appPassword}`).toString('base64') };
  return { [auth.header]: auth.format.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? '') };
};

const hubError = (error) => page('Hub error', `<p><strong>${escapeHtml(error.code)}</strong>: ${escapeHtml(error.message)}</p>${back('/connections')}`);

startApp({
  name: app.name,
  port: app.port,
  routes: {
    'GET /': async (ctx) => {
      if (!ctx.session.claims) {
        return ctx.html(page(app.name, '<p>Not signed in.</p><a class="button" href="/login">Sign in via SSO</a>'));
      }
      // Roles and permissions come from the app's resource JWT (roles via the JWT customizer, ID-07).
      const { payload } = await oidc.resourceToken(ctx.session);
      const rows = Object.entries(ctx.session.claims)
        .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(JSON.stringify(v))}</td></tr>`)
        .join('');
      ctx.html(page(app.name, `
        <p class="notice">Signed in as <strong>${escapeHtml(ctx.session.claims.email ?? ctx.session.claims.sub)}</strong></p>
        <h2>Roles and permissions</h2>
        <table>
          <tr><td>roles</td><td>${escapeHtml((payload.roles ?? []).join(', ') || '(none)')}</td></tr>
          <tr><td>scope (${escapeHtml(app.resource)})</td><td>${escapeHtml(payload.scope ?? '(none)')}</td></tr>
        </table>
        <h2>ID token claims (JWKS-verified)</h2><table>${rows}</table>
        <p>
          ${app.hub ? '<a class="button" href="/connections">Connections</a>' : ''}
          <a class="button" href="/userinfo">Userinfo</a>
          <a class="button" href="/api-token">API access token (JWT)</a>
          <a class="button" href="/login">Re-issue tokens (SSO)</a>
        </p>
        <p>
          <a class="button secondary" href="${escapeHtml(logtoEndpoint)}/account">Account center</a>
          <a class="button secondary" href="${escapeHtml(hubPublicUrl)}/account">Hub account</a>
          <a class="button secondary" href="/logout">SSO logout</a>
        </p>`));
    },
    'GET /login': async (ctx) => ctx.redirect(await oidc.loginUrl(ctx.session)),
    'GET /callback': async (ctx) => {
      await oidc.handleCallback(ctx.session, ctx.url);
      delete ctx.session.hubToken;
      ctx.redirect('/');
    },
    'GET /userinfo': async (ctx) => {
      if (!ctx.session.tokens) return ctx.redirect('/');
      const info = await oidc.userinfo(ctx.session);
      ctx.html(page('Userinfo', `${json(info)}${back()}`));
    },
    'GET /api-token': async (ctx) => {
      if (!ctx.session.tokens) return ctx.redirect('/');
      const { protectedHeader, payload } = await oidc.resourceToken(ctx.session);
      ctx.html(page(`Access token for ${app.resource}`, `
        <p class="notice">Signature verified against ${escapeHtml(logtoEndpoint)}/oidc/jwks</p>
        <h2>Header</h2>${json(protectedHeader)}
        <h2>Payload (includes custom claims from profile customData)</h2>${json(payload)}
        ${back()}`));
    },

    // TV-04: connections the user has allowed this app to use; plus a "use" link per allowed connector.
    'GET /connections': async (ctx) => {
      if (!ctx.session.tokens || !app.hub) return ctx.redirect('/');
      const { data, error } = await hub(ctx.session, 'GET', '/v1/connections');
      if (error) return ctx.html(hubError(error), 502);
      const rows = data
        .map((c) => `<tr><td>${escapeHtml(c.label)}</td><td>${escapeHtml(c.connectorId)}</td><td>${escapeHtml(c.status)}</td>
          <td><a href="/record?connectionId=${encodeURIComponent(c.id)}">Fetch a record</a></td></tr>`)
        .join('');
      const connectors = app.hub.allowedConnectors
        .map((id) => `<a class="button secondary" href="/record?connectorId=${encodeURIComponent(id)}">${escapeHtml(id)}</a>`)
        .join('');
      ctx.html(page('Connections', `
        <h2>Allowed for ${escapeHtml(app.name)}</h2>
        ${rows ? `<table><tr><th>Label</th><th>Connector</th><th>Status</th><th></th></tr>${rows}</table>` : '<p>No connections allowed yet.</p>'}
        <h2>Use a connector</h2><p>${connectors}</p>
        ${back()}`));
    },

    // TV-05: credentials for one connection (by id, or by connector), then one record from the provider.
    // consent_required / connection_reauth_required send the user to the Hub, which returns here.
    'GET /record': async (ctx) => {
      if (!ctx.session.tokens || !app.hub) return ctx.redirect('/');
      const connectionId = ctx.url.searchParams.get('connectionId');
      const target = connectionId ? { connectionId } : { connectorId: ctx.url.searchParams.get('connectorId') };
      const { data, error } = await hub(ctx.session, 'POST', '/v1/credentials', { ...target, returnTo: `${app.baseUrl}/connections` });
      if (error?.consentUrl) return ctx.redirect(error.consentUrl);
      if (error?.reconnectUrl) return ctx.redirect(error.reconnectUrl);
      if (error) return ctx.html(hubError(error), 502);
      const path = RECORD_PATHS[data.connectorId];
      if (!path) return ctx.html(page('Record', `<p>No record path for ${escapeHtml(data.connectorId)}.</p>${back('/connections')}`), 501);
      const res = await fetch(`${data.baseUrl.replace(/\/$/, '')}${path}`, { headers: { accept: 'application/json', ...authHeader(data) } });
      const record = await res.json().catch(() => null);
      // The secret itself is never shown.
      ctx.html(page(`Record from ${data.connectorId}`, `
        <table>
          <tr><td>connection</td><td>${escapeHtml(data.connectionId)}</td></tr>
          <tr><td>auth type</td><td>${escapeHtml(data.authType)}</td></tr>
          <tr><td>expires</td><td>${escapeHtml(data.expiresAt ?? 'never')}</td></tr>
          <tr><td>request</td><td>GET ${escapeHtml(data.baseUrl)}${escapeHtml(path)} → ${res.status}</td></tr>
        </table>
        ${json(record)}
        ${back('/connections')}`), res.ok ? 200 : 502);
    },

    'GET /logout': (ctx) => {
      delete ctx.session.hubToken;
      ctx.redirect(oidc.logoutUrl(ctx.session, `${app.baseUrl}/`));
    },
  },
});
