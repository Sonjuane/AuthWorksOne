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

// Admin view (AU-04): newest first, filtered by user, event, client, and time range; paged by `before` id.
export async function queryAudit(sql, tenantId, { sub, event, clientId, from, to, before, limit = 50 } = {}) {
  const size = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const rows = await sql`
    select id, at, sub, client_id, connection_id, host(ip) as ip, user_agent, event_type, result, error_code, detail
    from audit_log where tenant_id = ${tenantId}
      ${sub ? sql`and sub = ${sub}` : sql``}
      ${event ? sql`and event_type = ${event}` : sql``}
      ${clientId ? sql`and client_id = ${clientId}` : sql``}
      ${from ? sql`and at >= ${new Date(from)}` : sql``}
      ${to ? sql`and at < ${new Date(to)}` : sql``}
      ${before ? sql`and id < ${Number(before)}` : sql``}
    order by id desc limit ${size + 1}`;
  return { entries: rows.slice(0, size).map((r) => ({ ...r, id: Number(r.id) })), nextBefore: rows.length > size ? Number(rows[size - 1].id) : null };
}

export function createAudit({ sql, tenantId, redact = (v) => v }) {
  return async function record({ event, result = 'success', sub, clientId, connectionId, ip, userAgent, errorCode, detail = {} }) {
    if (!AUDIT_EVENTS.includes(event)) throw new Error(`unknown audit event ${event}`);
    await sql`
      insert into audit_log (tenant_id, sub, client_id, connection_id, ip, user_agent, event_type, result, error_code, detail)
      values (${tenantId}, ${sub ?? null}, ${clientId ?? null}, ${connectionId ?? null}, ${ip ?? null}, ${userAgent ?? null},
              ${event}, ${result}, ${errorCode ?? null}, ${sql.json(redact(detail))})`;
  };
}
