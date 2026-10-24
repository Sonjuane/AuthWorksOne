// JSON API for the Hub UI (session-authenticated; CSRF on writes). Ids travel in bodies, so no
// path parameters are needed.
import { ApiError } from '../core/auth.js';
import { respond } from '../core/http.js';
import { requestContext, requireCsrf, requireUser } from '../core/security.js';

const readBody = async (ctx) => {
  try {
    return await ctx.body();
  } catch {
    throw new ApiError(400, 'invalid_request', 'Body must be JSON');
  }
};

// Write route: signed-in user + CSRF + JSON body.
const write = (handler) => async (ctx) => {
  const user = requireUser(ctx);
  requireCsrf(ctx);
  return respond(ctx, await handler({ user, body: await readBody(ctx), context: requestContext(ctx) }));
};

export const uiApiRoutes = ({ connections, consents }) => ({
  // Consent page data (TV-02): ?client_id=…&connection_id=… | &connector=…, optional &return_to=…
  'GET /ui-api/consent': async (ctx) => {
    const user = requireUser(ctx);
    const params = ctx.url.searchParams;
    return respond(ctx, await consents.describe({
      sub: user.sub,
      clientId: params.get('client_id'),
      connectionId: params.get('connection_id') ?? undefined,
      connectorId: params.get('connector') ?? undefined,
      returnTo: params.get('return_to') ?? undefined,
    }));
  },

  // { clientId, connectionId, returnTo } -> { redirectTo } (a registered consent return URI only).
  'POST /ui-api/consent': write(({ user, body, context }) =>
    consents.grant({ sub: user.sub, clientId: body.clientId, connectionId: body.connectionId, returnTo: body.returnTo, context })),

  // App access (UI-03, TV-03)
  'GET /ui-api/grants': async (ctx) => respond(ctx, await consents.list(requireUser(ctx).sub)),

  'POST /ui-api/grants/revoke': write(async ({ user, body, context }) => {
    await consents.revoke({ sub: user.sub, grantId: body.grantId, context });
    return { revoked: body.grantId };
  }),

  'GET /ui-api/session': (ctx) => respond(ctx, { user: ctx.session.user ?? null, csrf: ctx.session.user ? ctx.session.csrf : null }),

  'GET /ui-api/connectors': (ctx) => {
    requireUser(ctx);
    return respond(ctx, connections.available());
  },

  'GET /ui-api/connections': async (ctx) => respond(ctx, await connections.list(requireUser(ctx).sub)),

  // Form flows: { connectorId, label, input } or { connectionId, input } to replace a credential.
  'POST /ui-api/connections': write(({ user, body, context }) =>
    connections.createFromInput({ sub: user.sub, connectorId: body.connectorId, label: body.label, input: body.input, connectionId: body.connectionId, context })),

  'POST /ui-api/connections/relabel': write(({ user, body }) => connections.relabel({ sub: user.sub, connectionId: body.connectionId, label: body.label })),

  'POST /ui-api/connections/delete': write(async ({ user, body, context }) => {
    await connections.remove({ sub: user.sub, connectionId: body.connectionId, context });
    return { deleted: body.connectionId };
  }),
});
