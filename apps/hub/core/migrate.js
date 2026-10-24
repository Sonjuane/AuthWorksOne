// Versioned SQL migrations (NF-08): apps/hub/migrations/NNN_name.sql, applied in order, each in a
// transaction, recorded in schema_migrations (runner metadata; no tenant_id).
import { readdirSync, readFileSync } from 'node:fs';
import { pendingMigrations } from './db.js';

const dir = new URL('../migrations/', import.meta.url);

export const migrationFiles = () =>
  readdirSync(dir)
    .filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((file) => ({ version: Number(file.slice(0, 3)), file }));

export async function migrate(sql, log = console.log) {
  await sql`create table if not exists schema_migrations (version int primary key, name text not null, applied_at timestamptz not null default now())`;
  const files = migrationFiles();
  const pending = new Set(await pendingMigrations(sql, files.map((m) => m.version)));
  for (const { version, file } of files) {
    if (!pending.has(version)) {
      log(`= ${file}`);
      continue;
    }
    await sql.begin(async (tx) => {
      await tx.unsafe(readFileSync(new URL(file, dir), 'utf8'));
      await tx`insert into schema_migrations (version, name) values (${version}, ${file})`;
    });
    log(`+ ${file}`);
  }
}
