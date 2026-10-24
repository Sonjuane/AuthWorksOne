// Connection lifecycle (VA-01..VA-07): connect via the bound auth type (OAuth redirect or user
// input), credential test before storing, sealed secrets, on-demand refresh under a Postgres
// advisory lock (one refresh per connection across instances), needs_reauth on refresh failure,
// provider revoke + delete on disconnect. Every lifecycle event is audited.
import { createHash, randomBytes } from 'node:crypto';
import { ApiError } from './auth.js';
import { handlerContext, resolveBaseUrl } from './extension.js';
import { aadFor } from './sealed.js';

const REFRESH_WINDOW_MS = 5 * 60 * 1000;
const STATE_TTL_SECONDS = 600;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

// VA-05: refresh when the access token expires within 5 minutes (null = never expires).
export const needsRefresh = (expiresAt, now = Date.now()) => expiresAt != null && new Date(expiresAt).getTime() - now <= REFRESH_WINDOW_MS;

// Public API shape (openapi.json Connection) and the Hub UI's richer view.
export const toApiConnection = (row) => ({
  id: row.id,
  connectorId: row.connector_id,
  label: row.label,
  status: row.status,
  ...(row.base_url ? { baseUrl: row.base_url } : {}),
});
export const toUiConnection = (row) => ({
  ...toApiConnection(row),
  providerAccountId: row.provider_account_id ?? null,
  lastErrorCode: row.last_error_code ?? null,
  createdAt: row.created_at,
  lastRefreshedAt: row.last_refreshed_at ?? null,
});

// HandlerError -> stable API error (the code tells the UI what to show).
const fromHandler = (err) => {
  if (err instanceof ApiError) return err;
  const status = { invalid_input: 400, provider_denied: 400, provider_unavailable: 503 }[err.code] ?? 400;
  return new ApiError(status, err.code ?? 'connection_failed', err.message);
};

export function createConnections({ sql, vault, registry, tenantId, http, baseUrl, audit, log }) {
  const redirectUri = `${baseUrl}/connect/callback`;
  const secretAad = (id) => aadFor(tenantId, 'connection_secrets', id);
  const stateAad = (hash) => aadFor(tenantId, 'oauth_states', hash);
  const ctxFor = (entry, providerBase) => handlerContext(entry, { baseUrl: providerBase, redirectUri, http });
  const remember = (credential) => Object.values(credential).forEach((value) => log.registerTransient(value));
  const notFound = () => new ApiError(404, 'connection_not_found', 'No such connection');

  const entryFor = (connectorId) => {
    const entry = registry.connectors.get(connectorId);
    if (!entry) throw new ApiError(404, 'connector_not_available', `Connector "${connectorId}" is not available`);
    return entry;
  };
  const owned = async (sub, id, db = sql) => {
    if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw notFound();
    const [row] = await db`select * from connections where tenant_id = ${tenantId} and id = ${id} and sub = ${sub}`;
    if (!row) throw notFound();
    return row;
  };
  const reauth = (row) => {
    const redirect = typeof registry.connectors.get(row.connector_id)?.handler.authorize === 'function';
    return new ApiError(409, 'connection_reauth_required', 'The user must re-authorize this connection', {
      reconnectUrl: redirect ? `${baseUrl}/connect/start?connectionId=${row.id}` : `${baseUrl}/connections?reconnect=${row.id}`,
    });
  };

  // Credential test (VA-03); a failed test is audited and nothing is stored.
  const testCredential = async (entry, ctx, credential, auditFields) => {
    let result;
    try {
      result = await entry.handler.test(ctx, credential);
    } catch (err) {
      await audit({ ...auditFields, result: 'failure', errorCode: err.code ?? 'connection_failed' });
      throw fromHandler(err);
    }
    if (!result.ok) {
      await audit({ ...auditFields, result: 'failure', errorCode: 'connection_test_failed', detail: { ...auditFields.detail, status: result.status } });
      throw new ApiError(400, 'connection_test_failed', `The provider rejected the credentials (HTTP ${result.status})`);
    }
    return result;
  };

  // Inserts a connection (or re-activates one on reconnect) with its sealed credential.
  const store = ({ sub, entry, label, credential, providerBase, account, connectionId }) =>
    sql.begin(async (tx) => {
      const fields = { base: providerBase, expires: credential.expiresAt ?? null, account: account?.id ?? null };
      const [row] = connectionId
        ? await tx`update connections set status = 'active', last_error_code = null, base_url = ${fields.base},
                     access_expires_at = ${fields.expires}, provider_account_id = ${fields.account}, updated_at = now()
                   where tenant_id = ${tenantId} and id = ${connectionId} and sub = ${sub} returning *`
        : await tx`insert into connections (tenant_id, sub, connector_id, label, status, base_url, access_expires_at, provider_account_id)
                   values (${tenantId}, ${sub}, ${entry.definition.id}, ${label}, 'active', ${fields.base}, ${fields.expires}, ${fields.account})
                   returning *`;
      if (!row) throw notFound();
      await tx`insert into connection_secrets (tenant_id, connection_id, key_version, sealed)
               values (${tenantId}, ${row.id}, ${vault.current}, ${vault.seal(credential, secretAad(row.id))})
               on conflict (tenant_id, connection_id) do update set key_version = excluded.key_version, sealed = excluded.sealed`;
      return row;
    });

  const cleanLabel = (label) => {
    const value = String(label ?? '').trim();
    if (!value || value.length > 100) throw new ApiError(400, 'invalid_request', 'label is required (1-100 characters)');
    return value;
  };

  return {
    // Connectors a user can add (enabled, env present); credential field metadata only.
    available: () =>
      [...registry.connectors.values()].map(({ definition, handler }) => ({
        id: definition.id,
        name: definition.name,
        authType: definition.authType,
        flow: typeof handler.authorize === 'function' ? 'redirect' : 'form',
        credentialFields: definition.credentialFields ?? [],
      })),

    // Redirect flow, step 1. `connectionId` re-authorizes an existing connection.
    async startOAuth({ sub, connectorId, label, connectionId, returnTo }) {
      const existing = connectionId ? await owned(sub, connectionId) : null;
      const entry = entryFor(existing?.connector_id ?? connectorId);
      if (typeof entry.handler.authorize !== 'function') throw new ApiError(400, 'invalid_request', `${entry.definition.id} does not use a redirect flow`);
      const state = b64url(randomBytes(24));
      const codeVerifier = b64url(randomBytes(32));
      const stateHash = sha256(state);
      await sql`insert into oauth_states (tenant_id, state_hash, sub, connector_id, connection_id, label, return_to, key_version, sealed, expires_at)
                values (${tenantId}, ${stateHash}, ${sub}, ${entry.definition.id}, ${existing?.id ?? null}, ${existing ? existing.label : cleanLabel(label)},
                        ${returnTo ?? null}, ${vault.current}, ${vault.seal({ codeVerifier }, stateAad(stateHash))}, now() + ${STATE_TTL_SECONDS} * interval '1 second')`;
      const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
      const { redirectUrl } = await entry.handler.authorize(ctxFor(entry, resolveBaseUrl(entry.definition)), { state, codeChallenge });
      return { redirectUrl };
    },

    // Redirect flow, step 2 (provider callback). State is single-use, bound to the user, 10-min TTL.
    async completeOAuth({ sub, query, context = {} }) {
      const stateHash = sha256(query.get('state') ?? '');
      const [pending] = await sql`delete from oauth_states where tenant_id = ${tenantId} and state_hash = ${stateHash} and sub = ${sub} returning *`;
      if (!pending || new Date(pending.expires_at) < new Date()) throw new ApiError(400, 'invalid_state', 'The connect request expired or is invalid; start again');
      const entry = entryFor(pending.connector_id);
      const { codeVerifier } = vault.open(pending.sealed, stateAad(stateHash));
      const providerBase = resolveBaseUrl(entry.definition);
      const ctx = ctxFor(entry, providerBase);
      const event = pending.connection_id ? 'connection.reconnect' : 'connection.create';
      const auditFields = { event, sub, connectionId: pending.connection_id, ...context, detail: { connectorId: entry.definition.id } };
      let credential;
      try {
        credential = await entry.handler.handleCallback(ctx, { query, codeVerifier });
      } catch (err) {
        await audit({ ...auditFields, result: 'failure', errorCode: err.code ?? 'connection_failed' });
        throw fromHandler(err);
      }
      remember(credential);
      const result = await testCredential(entry, ctx, credential, auditFields);
      const row = await store({ sub, entry, label: pending.label, credential, providerBase, account: result.account, connectionId: pending.connection_id });
      await audit({ ...auditFields, connectionId: row.id });
      return { connection: toUiConnection(row), returnTo: pending.return_to };
    },

    // Form flow (api_key, app_password, ...). `connectionId` replaces an existing connection's secret.
    async createFromInput({ sub, connectorId, label, input = {}, connectionId, context = {} }) {
      const existing = connectionId ? await owned(sub, connectionId) : null;
      const entry = entryFor(existing?.connector_id ?? connectorId);
      if (typeof entry.handler.collectCredentials !== 'function') throw new ApiError(400, 'invalid_request', `${entry.definition.id} uses a redirect flow`);
      const fields = Object.fromEntries((entry.definition.credentialFields ?? []).map((f) => [f.name, String(input[f.name] ?? '').trim()]));
      const missing = (entry.definition.credentialFields ?? []).filter((f) => f.required !== false && !fields[f.name]).map((f) => f.name);
      if (missing.length) throw new ApiError(400, 'invalid_request', `Missing fields: ${missing.join(', ')}`);
      const providerBase = resolveBaseUrl(entry.definition, fields);
      const ctx = ctxFor(entry, providerBase);
      const event = existing ? 'connection.reconnect' : 'connection.create';
      const auditFields = { event, sub, connectionId: existing?.id, ...context, detail: { connectorId: entry.definition.id } };
      let credential;
      try {
        credential = await entry.handler.collectCredentials(ctx, fields);
      } catch (err) {
        await audit({ ...auditFields, result: 'failure', errorCode: err.code ?? 'connection_failed' });
        throw fromHandler(err);
      }
      remember(credential);
      const result = await testCredential(entry, ctx, credential, auditFields);
      const row = await store({ sub, entry, label: existing ? existing.label : cleanLabel(label), credential, providerBase, account: result.account, connectionId: existing?.id });
      await audit({ ...auditFields, connectionId: row.id });
      return toUiConnection(row);
    },

    list: async (sub) => (await sql`select * from connections where tenant_id = ${tenantId} and sub = ${sub} order by created_at`).map(toUiConnection),

    async relabel({ sub, connectionId, label }) {
      await owned(sub, connectionId);
      const [row] = await sql`update connections set label = ${cleanLabel(label)}, updated_at = now() where tenant_id = ${tenantId} and id = ${connectionId} returning *`;
      return toUiConnection(row);
    },

    // VA-06: revoke at the provider where supported (best effort), then delete secrets + consents.
    async remove({ sub, connectionId, context = {} }) {
      const row = await owned(sub, connectionId);
      const entry = registry.connectors.get(row.connector_id);
      let providerRevoked = false;
      if (typeof entry?.handler.revoke === 'function') {
        try {
          const [secret] = await sql`select sealed from connection_secrets where tenant_id = ${tenantId} and connection_id = ${row.id}`;
          if (secret) await entry.handler.revoke(ctxFor(entry, row.base_url), vault.open(secret.sealed, secretAad(row.id)));
          providerRevoked = true;
        } catch (err) {
          log.warn('provider_revoke_failed', { connectorId: row.connector_id, connectionId: row.id, code: err.code ?? 'error' });
        }
      }
      await sql`delete from connections where tenant_id = ${tenantId} and id = ${row.id}`;
      await audit({ event: 'connection.delete', sub, connectionId: row.id, ...context, detail: { connectorId: row.connector_id, providerRevoked } });
    },

    // Current credential for an owned, active connection; refreshes first when near expiry (VA-05).
    async issue({ sub, connectionId, context = {} }) {
      const row = await owned(sub, connectionId);
      const entry = registry.connectors.get(row.connector_id);
      if (!entry) throw notFound(); // connector disabled or its env removed (EX-05)
      if (row.status !== 'active') throw reauth(row);
      let credential;
      if (needsRefresh(row.access_expires_at)) {
        const outcome = await sql.begin(async (tx) => {
          await tx`select pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${row.id}`}, 0))`;
          const [current] = await tx`select status, access_expires_at from connections where tenant_id = ${tenantId} and id = ${row.id}`;
          const [secret] = await tx`select sealed from connection_secrets where tenant_id = ${tenantId} and connection_id = ${row.id}`;
          const stored = vault.open(secret.sealed, secretAad(row.id));
          if (current.status !== 'active') return { reauth: true };
          if (!needsRefresh(current.access_expires_at)) return { credential: stored }; // refreshed by another request
          try {
            const refreshed = await entry.handler.refresh(ctxFor(entry, row.base_url), stored);
            await tx`update connection_secrets set key_version = ${vault.current}, sealed = ${vault.seal(refreshed, secretAad(row.id))}
                     where tenant_id = ${tenantId} and connection_id = ${row.id}`;
            await tx`update connections set access_expires_at = ${refreshed.expiresAt ?? null}, last_refreshed_at = now(), updated_at = now()
                     where tenant_id = ${tenantId} and id = ${row.id}`;
            return { credential: refreshed };
          } catch (err) {
            if (err.code === 'provider_unavailable') return { unavailable: err };
            // Committed with the transaction, so the state survives the error we raise below.
            await tx`update connections set status = 'needs_reauth', last_error_code = ${err.code ?? 'refresh_failed'}, updated_at = now()
                     where tenant_id = ${tenantId} and id = ${row.id}`;
            return { failed: err };
          }
        });
        if (outcome.unavailable) throw fromHandler(outcome.unavailable);
        if (outcome.failed) {
          await audit({ event: 'connection.refresh_failure', result: 'failure', sub, connectionId: row.id, ...context, errorCode: outcome.failed.code ?? 'refresh_failed', detail: { connectorId: row.connector_id } });
          throw reauth(row);
        }
        if (outcome.reauth) throw reauth(row);
        credential = outcome.credential;
      } else {
        const [secret] = await sql`select sealed from connection_secrets where tenant_id = ${tenantId} and connection_id = ${row.id}`;
        credential = vault.open(secret.sealed, secretAad(row.id));
      }
      remember(credential);
      const [fresh] = await sql`select * from connections where tenant_id = ${tenantId} and id = ${row.id}`;
      return { connection: fresh, definition: entry.definition, issued: entry.handler.getCredentials(ctxFor(entry, row.base_url), credential) };
    },
  };
}
