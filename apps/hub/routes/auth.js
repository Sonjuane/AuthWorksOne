// Hub UI sign-in through Logto (HA-04): the Hub is a confidential Logto client using
// apps/lib/oidc.js; an existing Logto session signs the user in silently (SSO).
import { newCsrfToken, safeReturnPath } from '../core/security.js';

export const authRoutes = ({ oidc, baseUrl }) => ({
  'GET /login': async (ctx) => {
    ctx.session.returnTo = safeReturnPath(ctx.url.searchParams.get('returnTo'));
    return ctx.redirect(await oidc.loginUrl(ctx.session));
  },

  'GET /callback': async (ctx) => {
    // openid-client derives redirect_uri from this URL, so use the public base, not the bind address.
    await oidc.handleCallback(ctx.session, `${baseUrl}${ctx.url.pathname}${ctx.url.search}`);
    const { sub, email, name } = ctx.session.claims;
    ctx.session.user = { sub, email, name };
    ctx.session.csrf = newCsrfToken();
    const returnTo = ctx.session.returnTo ?? '/';
    delete ctx.session.returnTo;
    return ctx.redirect(returnTo);
  },

  'GET /logout': (ctx) => {
    const url = oidc.logoutUrl(ctx.session, `${baseUrl}/`);
    delete ctx.session.user;
    delete ctx.session.csrf;
    return ctx.redirect(url);
  },
});
