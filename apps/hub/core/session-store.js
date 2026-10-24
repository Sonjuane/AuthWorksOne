// Postgres session store for apps/lib/web.js (NF-02, NF-07): rows keyed by sha256(session id),
// session data sealed by the vault so Logto tokens never sit in plaintext (S12).
import { createHash } from 'node:crypto';

export function createSessionStore({ sql, vault, tenantId, ttlSeconds = 8 * 3600 }) {
  const hash = (sid) => createHash('sha256').update(sid).digest('hex');
  const aad = (sidHash) => `${tenantId}|sessions|${sidHash}`;
  return {
    async get(sid) {
      const sidHash = hash(sid);
      const [row] = await sql`select sealed from sessions where tenant_id = ${tenantId} and sid_hash = ${sidHash} and expires_at > now()`;
      return row ? vault.open(row.sealed, aad(sidHash)) : undefined;
    },
    async set(sid, data) {
      const sidHash = hash(sid);
      const sealed = vault.seal(data, aad(sidHash));
      await sql`
        insert into sessions (tenant_id, sid_hash, key_version, sealed, expires_at)
        values (${tenantId}, ${sidHash}, ${vault.current}, ${sealed}, now() + ${ttlSeconds} * interval '1 second')
        on conflict (tenant_id, sid_hash) do update
          set key_version = excluded.key_version, sealed = excluded.sealed, expires_at = excluded.expires_at, updated_at = now()`;
    },
  };
}
