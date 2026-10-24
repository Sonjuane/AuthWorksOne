// Public Hub API for client apps (apps/hub/openapi.json; TV-04..TV-06). Bearer Logto token for the
// Hub resource. Checks, in order: token -> scope -> registered client -> connector allowed for the
// client -> ownership -> consent -> connection status -> refresh. Rejections are audited (AU-02).
import { ApiError } from '../core/auth.js';
import { toApiConnection } from '../core/connections.js';
import { respond } from '../core/http.js';
import { requestContext } from '../core/security.js';

export const apiRoutes = ({ authenticate, connections, consents, audit, validate }) => {
  const guarded = (scope, handler) => async (ctx) => {
    const context = requestContext(ctx);
    let caller;
    try {
      caller = await authenticate(ctx.req.headers, scope);
      return await handler({ ctx, caller, context });
    } catch (err) {
      if (err instanceof ApiError) {
        await audit({
          event: 'api.reject',
          result: 'failure',
          sub: caller?.sub ?? err.claims?.sub,
          clientId: caller?.clientId ?? err.claims?.client_id,
          errorCode: err.code,
          ...context,
          detail: { method: ctx.req.method, path: ctx.url.pathname },
        });
      }
      throw err;
    }
  };

  const consentRequired = (caller, target, returnTo) =>
    new ApiError(403, 'consent_required', 'The user has not allowed this application to use this connection', {
      consentUrl: consents.consentUrl({ clientId: caller.clientId, ...target, returnTo }),
    });

  return {
    // TV-04
    'GET /v1/connections': guarded('connections:read', async ({ ctx, caller }) =>
      respond(ctx, (await consents.consented({ sub: caller.sub, clientId: caller.clientId })).map(toApiConnection))),

    // TV-05: one connection by id, or by connector when the app has no connection id yet.
    'POST /v1/credentials': guarded('connections:token', async ({ ctx, caller, context }) => {
      let body;
      try {
        body = await ctx.body();
      } catch {
        throw new ApiError(400, 'invalid_request', 'Body must be JSON');
      }
      const problem = validate('CredentialRequest', body);
      if (problem) throw new ApiError(400, 'invalid_request', problem);
      const returnTo = consents.returnUriFor(caller.client, body.returnTo);
      const { sub, clientId } = caller;

      let connectionId = body.connectionId;
      if (connectionId) {
        const row = await connections.get(sub, connectionId);
        consents.assertAllowed(caller.client, row.connector_id);
        if (!(await consents.has({ sub, clientId, connectionId }))) throw consentRequired(caller, { connectionId }, returnTo);
      } else {
        consents.assertAllowed(caller.client, body.connectorId);
        const consented = await consents.consented({ sub, clientId, connectorId: body.connectorId });
        if (!consented.length) throw consentRequired(caller, { connectorId: body.connectorId }, returnTo);
        if (consented.length > 1) {
          throw new ApiError(400, 'invalid_request', 'Several connections are consented for this connector; pass connectionId', {
            connections: consented.map(toApiConnection),
          });
        }
        connectionId = consented[0].id;
      }

      const { connection, definition, issued } = await connections.issue({ sub, connectionId, context });
      await audit({ event: 'credential.issue', sub, clientId, connectionId, ...context, detail: { connectorId: definition.id } });
      return respond(ctx, {
        connectionId,
        connectorId: definition.id,
        authType: definition.authType,
        secret: issued.secret,
        expiresAt: issued.expiresAt,
        baseUrl: connection.base_url,
        ...(definition.auth ? { auth: definition.auth } : {}),
      });
    }),
  };
};
