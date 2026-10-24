// Postgres client for the Hub database (NF-02).
import postgres from 'postgres';

export const connect = (url, options = {}) => postgres(url, { max: 10, onnotice: () => {}, ...options });

// Migration versions present in apps/hub/migrations but not yet applied.
export async function pendingMigrations(sql, versions) {
  const [{ exists }] = await sql`select to_regclass('schema_migrations') is not null as exists`;
  if (!exists) return versions;
  const applied = new Set((await sql`select version from schema_migrations`).map((r) => r.version));
  return versions.filter((v) => !applied.has(v));
}
