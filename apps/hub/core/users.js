// Deleted Logto users (VA-08): remove every Hub connection (provider revoke + delete) and consent
// for a `sub`. Shared by the Logto `User.Deleted` webhook and the operator reconciliation.
export async function purgeUser({ sql, tenantId, connections, audit, sub, source, context = {} }) {
  const rows = await sql`select id from connections where tenant_id = ${tenantId} and sub = ${sub}`;
  for (const { id } of rows) await connections.remove({ sub, connectionId: id, context });
  // Grants reference connections (cascade), so none remain; this catches any left by other paths.
  const grants = await sql`delete from consent_grants where tenant_id = ${tenantId} and sub = ${sub} returning 1`;
  // Audited only when the user had Hub data (every Logto user deletion triggers the webhook).
  if (rows.length || grants.length) await audit({ event: 'user.deleted', sub, ...context, detail: { source, connections: rows.length } });
  return { connections: rows.length };
}

// Users that own Hub data but no longer exist in Logto. Safety rails: an empty Logto user list
// or more than `maxShare` of Hub users missing aborts unless `force` (a misconfigured endpoint or
// tenant must not wipe the vault).
export async function findOrphans({ sql, tenantId, logtoUserIds, maxShare = 0.2, force = false }) {
  if (!logtoUserIds.size) throw new Error('Logto returned no users; refusing to reconcile');
  const subs = (await sql`
    select sub from connections where tenant_id = ${tenantId}
    union select sub from consent_grants where tenant_id = ${tenantId}`).map((r) => r.sub);
  const orphans = subs.filter((sub) => !logtoUserIds.has(sub));
  if (!force && orphans.length > Math.max(1, Math.floor(subs.length * maxShare))) {
    throw new Error(`${orphans.length} of ${subs.length} Hub users are missing from Logto (limit ${Math.round(maxShare * 100)}%); re-run with --force if that is correct`);
  }
  return { subs: subs.length, orphans };
}
