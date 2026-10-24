// Hub audit log (AU-02, AU-03): append-only rows; `detail` is redacted (VA-07).
export const AUDIT_EVENTS = [
  'connection.create',
  'connection.reconnect',
  'connection.refresh_failure',
  'connection.delete',
  'consent.grant',
  'consent.revoke',
  'credential.issue',
  'api.reject',
  'user.deleted',
];

export function createAudit({ sql, tenantId, redact = (v) => v }) {
  return async function record({ event, result = 'success', sub, clientId, connectionId, ip, userAgent, errorCode, detail = {} }) {
    if (!AUDIT_EVENTS.includes(event)) throw new Error(`unknown audit event ${event}`);
    await sql`
      insert into audit_log (tenant_id, sub, client_id, connection_id, ip, user_agent, event_type, result, error_code, detail)
      values (${tenantId}, ${sub ?? null}, ${clientId ?? null}, ${connectionId ?? null}, ${ip ?? null}, ${userAgent ?? null},
              ${event}, ${result}, ${errorCode ?? null}, ${sql.json(redact(detail))})`;
  };
}
