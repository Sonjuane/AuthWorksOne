// Browser redirect legs of connector OAuth (VA-01, VA-03): start -> provider -> callback.
// Results return to a same-origin Hub UI path with ?connected=<id> or ?connect_error=<code>.
import { ApiError } from '../core/auth.js';
import { requestContext, safeReturnPath } from '../core/security.js';

const withParam = (path, key, value) => `${path}${path.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`;

export const connectRoutes = ({ connections }) => ({
  // ?connector=<id>&label=<label>  or  ?connectionId=<id> (reconnect); optional &returnTo=/path
  'GET /connect/start': async (ctx) => {
    const params = ctx.url.searchParams;
    const returnTo = safeReturnPath(params.get('returnTo'), '/connections');
    if (!ctx.session.user) return ctx.redirect(`/login?returnTo=${encodeURIComponent(ctx.url.pathname + ctx.url.search)}`);
    try {
      const { redirectUrl } = await connections.startOAuth({
        sub: ctx.session.user.sub,
        connectorId: params.get('connector'),
        label: params.get('label'),
        connectionId: params.get('connectionId') ?? undefined,
        returnTo,
      });
      return ctx.redirect(redirectUrl);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      return ctx.redirect(withParam(returnTo, 'connect_error', err.code));
    }
  },

  'GET /connect/callback': async (ctx) => {
    if (!ctx.session.user) return ctx.redirect(withParam('/connections', 'connect_error', 'login_required'));
    try {
      const { connection, returnTo } = await connections.completeOAuth({ sub: ctx.session.user.sub, query: ctx.url.searchParams, context: requestContext(ctx) });
      return ctx.redirect(withParam(safeReturnPath(returnTo, '/connections'), 'connected', connection.id));
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      return ctx.redirect(withParam('/connections', 'connect_error', err.code));
    }
  },
});
