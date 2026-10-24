// JSON API for the Hub UI (session-authenticated; CSRF on writes). Ids travel in bodies, so no
// path parameters are needed.
import { AUDIT_EVENTS, queryAudit } from '../core/audit.js';
import { ApiError } from '../core/auth.js';
import { respond } from '../core/http.js';
import { requestContext, requireAdmin, requireCsrf, requireUser } from '../core/security.js';

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
  return respond(ctx, await handler({ ctx, user, body: await readBody(ctx), context: requestContext(ctx) }));
};

const isDate = (value) => !value || !Number.isNaN(Date.parse(value));

export const uiApiRoutes = ({ connections, consents, account, registry, config, sql }) => ({
  // Public: sign-in branding so the Hub UI matches the Logto pages (UI-06).
  'GET /ui-api/branding': (ctx) => respond(ctx, config.branding ?? {}),

  // Profile (UI-01) via the Logto Account API; security settings stay in Logto Account Center.
  'GET /ui-api/profile': async (ctx) => {
    requireUser(ctx);
    return respond(ctx, await account.get(ctx.session));
  },
  'POST /ui-api/profile': write(({ ctx, body }) => account.update(ctx.session, body)),

  // --- Hub admin (UI-05, AU-04): owner/admin only ---
  'GET /ui-api/admin/connectors': (ctx) => {
    requireAdmin(ctx, config.adminRoles);
    const skipped = new Map(registry.skipped.map((s) => [s.id, s]));
    return respond(ctx, [...registry.definitions.values()].map(({ definition, file }) => ({
      id: definition.id,
      name: definition.name,
      authType: definition.authType,
      file: file.split('/').slice(-2).join('/'),
      status: registry.connectors.has(definition.id) ? 'active' : skipped.get(definition.id)?.reason ?? 'inactive',
      missingEnv: skipped.get(definition.id)?.missingEnv ?? [],
    })));
  },
  'GET /ui-api/admin/clients': (ctx) => {
    requireAdmin(ctx, config.adminRoles);
    return respond(ctx, {
      clients: [...config.clients.entries()].map(([clientId, c]) => ({ clientId, key: c.key, name: c.name, allowedConnectors: c.allowedConnectors, consentReturnUris: c.consentReturnUris })),
      notProvisioned: config.skippedClients,
    });
  },
  'GET /ui-api/admin/audit': async (ctx) => {
    requireAdmin(ctx, config.adminRoles);
    const q = Object.fromEntries(ctx.url.searchParams);
    if (q.event && !AUDIT_EVENTS.includes(q.event)) throw new ApiError(400, 'invalid_request', 'Unknown event type');
    if (!isDate(q.from) || !isDate(q.to)) throw new ApiError(400, 'invalid_request', 'from/to must be dates');
    if (q.before && !/^\d+$/.test(q.before)) throw new ApiError(400, 'invalid_request', 'before must be an entry id');
    return respond(ctx, { events: AUDIT_EVENTS, ...(await queryAudit(sql, config.tenantId, { sub: q.sub, event: q.event, clientId: q.client, from: q.from, to: q.to, before: q.before, limit: q.limit })) });
  },

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

  'GET /ui-api/session': (ctx) => {
    const user = ctx.session.user ?? null;
    return respond(ctx, {
      user,
      csrf: user ? ctx.session.csrf : null,
      isAdmin: Boolean(user?.roles?.some((role) => config.adminRoles.includes(role))),
      accountCenterUrl: config.accountCenterUrl,
    });
  },

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
