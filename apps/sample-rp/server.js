// Sample relying party: proves a third-party app needs only the issuer URL +
// client ID/secret for PKCE login, JWKS-verified tokens, userinfo, and SSO logout.
import { readFileSync } from 'node:fs';
import { startApp, page, escapeHtml } from '../lib/web.js';
import { createOidc } from '../lib/oidc.js';

const config = JSON.parse(readFileSync(new URL('../../config/sso.config.json', import.meta.url)));
const app = config.applications.find((a) => a.key === 'sample-rp');
const logtoEndpoint = process.env.LOGTO_ENDPOINT.replace(/\/$/, '');

const oidc = await createOidc({
  issuer: `${logtoEndpoint}/oidc`,
  clientId: process.env.SAMPLE_RP_CLIENT_ID,
  clientSecret: process.env.SAMPLE_RP_CLIENT_SECRET,
  baseUrl: app.baseUrl,
  scope: app.scope,
  resource: app.resource,
});

const json = (value) => `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;

startApp({
  name: 'Sample RP',
  port: app.port,
  routes: {
    'GET /': (ctx) => {
      if (!ctx.session.claims) {
        return ctx.html(page('Sample RP', '<p>Not signed in.</p><a class="button" href="/login">Sign in via SSO</a>'));
      }
      const rows = Object.entries(ctx.session.claims)
        .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(JSON.stringify(v))}</td></tr>`)
        .join('');
      ctx.html(page('Sample RP', `
        <p class="notice">Signed in as <strong>${escapeHtml(ctx.session.claims.email ?? ctx.session.claims.sub)}</strong></p>
        <h2>ID token claims (JWKS-verified)</h2><table>${rows}</table>
        <p>
          <a class="button" href="/userinfo">Userinfo</a>
          <a class="button" href="/api-token">API access token (JWT)</a>
          <a class="button" href="/login">Re-issue tokens (SSO)</a>
        </p>
        <p>
          <a class="button secondary" href="${escapeHtml(logtoEndpoint)}/account">Account center</a>
          <a class="button secondary" href="http://localhost:3030/account">Hub account</a>
          <a class="button secondary" href="/logout">SSO logout</a>
        </p>`));
    },
    'GET /login': async (ctx) => ctx.redirect(await oidc.loginUrl(ctx.session)),
    'GET /callback': async (ctx) => {
      await oidc.handleCallback(ctx.session, ctx.url);
      ctx.redirect('/');
    },
    'GET /userinfo': async (ctx) => {
      if (!ctx.session.tokens) return ctx.redirect('/');
      const info = await oidc.userinfo(ctx.session);
      ctx.html(page('Userinfo', `${json(info)}<a class="button" href="/">Back</a>`));
    },
    'GET /api-token': async (ctx) => {
      if (!ctx.session.tokens) return ctx.redirect('/');
      const { protectedHeader, payload } = await oidc.resourceToken(ctx.session);
      ctx.html(page(`Access token for ${app.resource}`, `
        <p class="notice">Signature verified against ${escapeHtml(logtoEndpoint)}/oidc/jwks</p>
        <h2>Header</h2>${json(protectedHeader)}
        <h2>Payload (includes custom claims from profile customData)</h2>${json(payload)}
        <a class="button" href="/">Back</a>`));
    },
    'GET /logout': (ctx) => ctx.redirect(oidc.logoutUrl(ctx.session, `${app.baseUrl}/`)),
  },
});
