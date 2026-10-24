// Consent grants (TV-01..TV-03): a client app may use a connection only after the user grants
// that app (client_id) that connection. Return URIs are exact-match against the client's
// consentReturnUris (no open redirect). Grants and revocations are audited.
import { ApiError } from './auth.js';

export function createConsents({ sql, tenantId, clients, registry, baseUrl, audit }) {
  const clientFor = (clientId) => {
    const client = clients.get(clientId);
    if (!client) throw new ApiError(403, 'client_not_registered', 'The application is not registered with the Hub');
    return client;
  };
  // TV-02 / S11: only a registered return URI; default to the first one.
  const returnUriFor = (client, returnTo) => {
    if (returnTo === undefined || returnTo === null || returnTo === '') return client.consentReturnUris[0] ?? null;
    if (!client.consentReturnUris.includes(returnTo)) throw new ApiError(400, 'invalid_request', 'returnTo is not one of the application\'s registered consent return URIs');
    return returnTo;
  };
  const assertAllowed = (client, connectorId) => {
    if (!client.allowedConnectors.includes(connectorId)) {
      throw new ApiError(403, 'connector_not_allowed_for_client', `This application may not use ${connectorId} connections`);
    }
  };
  const ownedConnection = async (sub, connectionId) => {
    if (!/^[0-9a-f-]{36}$/i.test(String(connectionId))) throw new ApiError(404, 'connection_not_found', 'No such connection');
    const [row] = await sql`select * from connections where tenant_id = ${tenantId} and id = ${connectionId} and sub = ${sub}`;
    if (!row) throw new ApiError(404, 'connection_not_found', 'No such connection');
    return row;
  };

  return {
    clientFor,
    returnUriFor,
    assertAllowed,

    // Hub consent page URL handed to apps in `consent_required` (TV-06).
    consentUrl: ({ clientId, connectionId, connectorId, returnTo }) => {
      const url = new URL('/consent', baseUrl);
      url.searchParams.set('client_id', clientId);
      if (connectionId) url.searchParams.set('connection_id', connectionId);
      else url.searchParams.set('connector', connectorId);
      if (returnTo) url.searchParams.set('return_to', returnTo);
      return url.href;
    },

    // Consented connections for (user, app), optionally one connector. Disabled connectors are hidden (EX-05).
    async consented({ sub, clientId, connectorId }) {
      const client = clientFor(clientId);
      const rows = await sql`
        select c.* from consent_grants g join connections c on c.tenant_id = g.tenant_id and c.id = g.connection_id
        where g.tenant_id = ${tenantId} and g.sub = ${sub} and g.client_id = ${clientId}
          ${connectorId ? sql`and c.connector_id = ${connectorId}` : sql``}
        order by c.created_at`;
      return rows.filter((row) => client.allowedConnectors.includes(row.connector_id) && registry.connectors.has(row.connector_id));
    },

    has: async ({ sub, clientId, connectionId }) =>
      (await sql`select 1 from consent_grants where tenant_id = ${tenantId} and sub = ${sub} and client_id = ${clientId} and connection_id = ${connectionId}`).length > 0,

    // Data for the consent page (TV-02): app name, connector, and the user's matching connections.
    async describe({ sub, clientId, connectionId, connectorId, returnTo }) {
      const client = clientFor(clientId);
      const target = connectionId ? await ownedConnection(sub, connectionId) : null;
      const id = target?.connector_id ?? connectorId;
      assertAllowed(client, id);
      const entry = registry.connectors.get(id);
      if (!entry) throw new ApiError(404, 'connector_not_available', `Connector "${id}" is not available`);
      const candidates = target
        ? [target]
        : await sql`select * from connections where tenant_id = ${tenantId} and sub = ${sub} and connector_id = ${id} order by created_at`;
      return {
        app: { clientId, name: client.name },
        connector: { id, name: entry.definition.name, flow: typeof entry.handler.authorize === 'function' ? 'redirect' : 'form' },
        connections: candidates.map((c) => ({ id: c.id, label: c.label, status: c.status })),
        returnTo: returnUriFor(client, returnTo),
      };
    },

    async grant({ sub, clientId, connectionId, returnTo, context = {} }) {
      const client = clientFor(clientId);
      const connection = await ownedConnection(sub, connectionId);
      assertAllowed(client, connection.connector_id);
      const redirectTo = returnUriFor(client, returnTo);
      await sql`insert into consent_grants (tenant_id, sub, client_id, connection_id) values (${tenantId}, ${sub}, ${clientId}, ${connectionId})
                on conflict (tenant_id, client_id, connection_id) do nothing`;
      await audit({ event: 'consent.grant', sub, clientId, connectionId, ...context, detail: { connectorId: connection.connector_id } });
      return { redirectTo };
    },

    async revoke({ sub, grantId, context = {} }) {
      if (!/^[0-9a-f-]{36}$/i.test(String(grantId))) throw new ApiError(404, 'grant_not_found', 'No such grant');
      const [row] = await sql`delete from consent_grants where tenant_id = ${tenantId} and id = ${grantId} and sub = ${sub} returning *`;
      if (!row) throw new ApiError(404, 'grant_not_found', 'No such grant');
      await audit({ event: 'consent.revoke', sub, clientId: row.client_id, connectionId: row.connection_id, ...context });
    },

    // App access view (UI-03): every grant with app name, connector, and connection label.
    list: async (sub) =>
      (await sql`
        select g.id, g.client_id, g.granted_at, c.id as connection_id, c.label, c.connector_id, c.status
        from consent_grants g join connections c on c.tenant_id = g.tenant_id and c.id = g.connection_id
        where g.tenant_id = ${tenantId} and g.sub = ${sub} order by g.granted_at`).map((row) => ({
        id: row.id,
        app: { clientId: row.client_id, name: clients.get(row.client_id)?.name ?? row.client_id },
        connection: { id: row.connection_id, label: row.label, connectorId: row.connector_id, status: row.status },
        grantedAt: row.granted_at,
      })),
  };
}
