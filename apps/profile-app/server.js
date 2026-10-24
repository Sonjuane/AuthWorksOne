// Custom-branded profile UI (approach B): signs in via SSO, then reads/updates the
// user's own profile through the Logto Account API with the user's access token.
import { readFileSync } from 'node:fs';
import { startApp, page, escapeHtml } from '../lib/web.js';
import { createOidc } from '../lib/oidc.js';

const config = JSON.parse(readFileSync(new URL('../../config/sso.config.json', import.meta.url)));
const app = config.applications.find((a) => a.key === 'profile-app');
const logtoEndpoint = process.env.LOGTO_ENDPOINT.replace(/\/$/, '');
const customFields = config.customProfileFields ?? [];

const oidc = await createOidc({
  issuer: `${logtoEndpoint}/oidc`,
  clientId: process.env.PROFILE_APP_CLIENT_ID,
  clientSecret: process.env.PROFILE_APP_CLIENT_SECRET,
  baseUrl: app.baseUrl,
  scope: app.scope,
});

// Account API: opaque user access token, permissions governed by account-center fields.
async function accountApi(session, method = 'GET', body) {
  const res = await fetch(`${logtoEndpoint}/api/my-account`, {
    method,
    headers: {
      Authorization: `Bearer ${session.tokens.access_token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Account API ${method} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

const input = (name, label, value) => `
  <label for="${name}">${escapeHtml(label)}</label>
  <input id="${name}" name="${name}" value="${escapeHtml(value ?? '')}">`;

startApp({
  name: 'Profile App',
  port: app.port,
  routes: {
    'GET /': async (ctx) => {
      if (!ctx.session.claims) {
        return ctx.html(page('Profile App', '<p>Not signed in.</p><a class="button" href="/login">Sign in via SSO</a>'));
      }
      const account = await accountApi(ctx.session);
      const customInputs = customFields
        .map((f) => input(f.name, f.label, account.customData?.[f.name]))
        .join('');
      ctx.html(page('Your profile', `
        ${ctx.url.searchParams.has('saved') ? '<p class="notice">Saved. Claims update on the next token issuance.</p>' : ''}
        <p>Signed in as <strong>${escapeHtml(account.primaryEmail ?? account.id)}</strong></p>
        <form method="post" action="/profile">
          ${input('name', 'Full name', account.name)}
          ${input('avatar', 'Avatar URL', account.avatar)}
          ${customInputs}
          <p><button type="submit">Save</button></p>
        </form>
        <p>
          <a class="button secondary" href="${escapeHtml(logtoEndpoint)}/account">Prebuilt account center</a>
          <a class="button secondary" href="http://localhost:3010/">Sample RP</a>
          <a class="button secondary" href="/logout">SSO logout</a>
        </p>`));
    },
    'POST /profile': async (ctx) => {
      if (!ctx.session.tokens) return ctx.redirect('/');
      const form = await ctx.form();
      const account = await accountApi(ctx.session);
      const customData = { ...account.customData };
      for (const field of customFields) customData[field.name] = form[field.name] ?? '';
      await accountApi(ctx.session, 'PATCH', { name: form.name, avatar: form.avatar || undefined, customData });
      ctx.redirect('/?saved');
    },
    'GET /login': async (ctx) => ctx.redirect(await oidc.loginUrl(ctx.session)),
    'GET /callback': async (ctx) => {
      await oidc.handleCallback(ctx.session, ctx.url);
      ctx.redirect('/');
    },
    'GET /logout': (ctx) => ctx.redirect(oidc.logoutUrl(ctx.session, `${app.baseUrl}/`)),
  },
});
